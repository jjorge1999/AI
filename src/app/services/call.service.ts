import { Injectable } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';
import { initializeApp } from 'firebase/app';
import {
  initializeFirestore,
  getFirestore,
  collection,
  doc,
  setDoc,
  onSnapshot,
  updateDoc,
  addDoc,
  query,
  where,
  orderBy,
  limit,
  collectionGroup,
  getDoc,
  deleteDoc,
  Unsubscribe,
} from 'firebase/firestore';
import { environment } from '../../environments/environment';
import { WebRTCCall } from '../models/inventory.models';

@Injectable({
  providedIn: 'root',
})
export class CallService {
  private app = initializeApp(environment.firebaseConfig);
  private db = initializeFirestore(this.app, {
    experimentalForceLongPolling: true,
  });

  private peerConnection: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;

  private callDocSubscription: Unsubscribe | null = null;
  private offerCandidatesSubscription: Unsubscribe | null = null;
  private answerCandidatesSubscription: Unsubscribe | null = null;

  public incomingCall$ = new Subject<WebRTCCall | null>();
  public callStatus$ = new BehaviorSubject<string>('idle'); // idle, calling, connected, incoming
  public remoteStream$ = new BehaviorSubject<MediaStream | null>(null);
  public error$ = new Subject<string>();

  private currentCallId: string | null = null;
  private candidateQueue: RTCIceCandidate[] = [];

  private servers = {
    iceServers: [
      {
        urls: [
          'stun:stun.l.google.com:19302',
          'stun:stun1.l.google.com:19302',
          'stun:stun2.l.google.com:19302',
          'stun:stun3.l.google.com:19302',
          'stun:stun4.l.google.com:19302',
        ],
      },
    ],
  };

  constructor() {}

  async initializeCall(conversationId: string, callerName: string) {
    try {
      this.currentCallId = null;
      this.callStatus$.next('calling');

      // 1. Create Call Doc
      const callDocRef = doc(collection(this.db, 'calls'));
      this.currentCallId = callDocRef.id;

      // 2. Get Local Stream
      await this.setupLocalMedia();

      // 3. Create Peer Connection
      this.setupPeerConnection(this.currentCallId);

      // 4. Add Local Tracks to PC
      if (this.localStream) {
        this.localStream.getTracks().forEach((track) => {
          if (this.peerConnection && this.localStream) {
            this.peerConnection.addTrack(track, this.localStream);
          }
        });
      }

      // 5. Create Offer
      const offerDescription = await this.peerConnection!.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: false,
      });
      await this.peerConnection!.setLocalDescription(offerDescription);

      const callData: any = {
        id: this.currentCallId,
        conversationId,
        callerName,
        status: 'offering',
        offer: {
          type: offerDescription.type,
          sdp: offerDescription.sdp,
        },
        timestamp: new Date(),
      };

      await setDoc(callDocRef, callData);

      // 6. Listen for Answer
      this.callDocSubscription = onSnapshot(callDocRef, async (snapshot) => {
        const data = snapshot.data();
        if (!this.peerConnection || !data) return;

        if (
          this.peerConnection.signalingState === 'have-local-offer' &&
          data['answer']
        ) {
          const answerDescription = new RTCSessionDescription(data['answer']);
          await this.peerConnection.setRemoteDescription(answerDescription);
          this.callStatus$.next('connected');

          // Flush candidate buffer
          this.candidateQueue.forEach((c) => {
            this.peerConnection
              ?.addIceCandidate(c)
              .catch((e) =>
                console.error('Error adding buffered candidate', e)
              );
          });
          this.candidateQueue = []; // clear
        }

        // Handle rejection/end
        if (data['status'] === 'ended' || data['status'] === 'rejected') {
          this.endCallInternal();
        }
      });

      // 7. Listen for Remote ICE Candidates (Answer Candidates)
      const answerCandidatesRef = collection(callDocRef, 'answerCandidates');
      this.answerCandidatesSubscription = onSnapshot(
        answerCandidatesRef,
        (snapshot) => {
          snapshot.docChanges().forEach((change) => {
            if (change.type === 'added') {
              const candidateData = change.doc.data();
              const candidate = new RTCIceCandidate(candidateData);

              if (this.peerConnection?.remoteDescription) {
                this.peerConnection
                  .addIceCandidate(candidate)
                  .catch((e) => console.error('Error adding candidate', e));
              } else {
                console.log('Buffering candidate...');
                this.candidateQueue.push(candidate);
              }
            }
          });
        }
      );
    } catch (e: any) {
      console.error('Call Initialization Failed:', e);
      this.error$.next('Failed to start call: ' + (e.message || e));
      this.endCallInternal();
    }
  }

  async answerCall(call: WebRTCCall) {
    try {
      this.currentCallId = call.id;
      this.callStatus$.next('connected');

      const callDocRef = doc(this.db, 'calls', call.id);

      // 1. Get Local Stream
      await this.setupLocalMedia();

      // 2. Create Peer Connection
      this.setupPeerConnection(call.id);

      // 3. Add Local Tracks
      this.localStream!.getTracks().forEach((track) => {
        this.peerConnection!.addTrack(track, this.localStream!);
      });

      // 4. Set Remote Description (Offer)
      const offerDescription = call.offer;
      await this.peerConnection!.setRemoteDescription(
        new RTCSessionDescription(offerDescription)
      );

      // 5. Create Answer
      const answerDescription = await this.peerConnection!.createAnswer();
      await this.peerConnection!.setLocalDescription(answerDescription);

      const answer = {
        type: answerDescription.type,
        sdp: answerDescription.sdp,
      };

      await updateDoc(callDocRef, { answer, status: 'answered' });

      // 6. Listen for Remote ICE Candidates (Offer Candidates)
      const offerCandidatesRef = collection(callDocRef, 'offerCandidates');
      this.offerCandidatesSubscription = onSnapshot(
        offerCandidatesRef,
        (snapshot) => {
          snapshot.docChanges().forEach((change) => {
            if (change.type === 'added') {
              const candidateData = change.doc.data();
              const candidate = new RTCIceCandidate(candidateData);

              // For Answerer, remote description should be set by steps 4 above.
              if (this.peerConnection?.remoteDescription) {
                this.peerConnection
                  .addIceCandidate(candidate)
                  .catch((e) =>
                    console.error('Error adding offer candidate', e)
                  );
              }
            }
          });
        }
      );

      // 7. Listen for Call End
      this.callDocSubscription = onSnapshot(callDocRef, (snapshot) => {
        const data = snapshot.data();
        if (data && data['status'] === 'ended') {
          this.endCallInternal();
        }
      });
    } catch (e: any) {
      console.error('Error answering call:', e);
      this.error$.next('Failed to answer call: ' + (e.message || e));
      this.endCallInternal();
    }
  }

  async endCall() {
    if (this.currentCallId) {
      const callDocRef = doc(this.db, 'calls', this.currentCallId);
      // We don't delete immediately to let other peer know, but set status to ended
      await updateDoc(callDocRef, { status: 'ended' }).catch(() => {});
    }
    this.endCallInternal();
  }

  rejectCall(callId: string) {
    const callDocRef = doc(this.db, 'calls', callId);
    updateDoc(callDocRef, { status: 'rejected' }).catch(() => {});
  }

  private endCallInternal() {
    this.callStatus$.next('idle');
    this.remoteStream$.next(null);

    // Cleanup Media
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }
    if (this.remoteStream) {
      this.remoteStream.getTracks().forEach((track) => track.stop());
      this.remoteStream = null;
    }

    // Cleanup Peer Connection
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    // Cleanup Subscriptions
    if (this.callDocSubscription) {
      this.callDocSubscription();
      this.callDocSubscription = null;
    }
    if (this.offerCandidatesSubscription) {
      this.offerCandidatesSubscription();
      this.offerCandidatesSubscription = null;
    }
    if (this.answerCandidatesSubscription) {
      this.answerCandidatesSubscription();
      this.answerCandidatesSubscription = null;
    }

    this.currentCallId = null;
  }

  private async setupLocalMedia() {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      console.log('CallService: Local media acquired', this.localStream);
      this.localStream.getAudioTracks().forEach((track) => {
        console.log(
          'Local Track:',
          track.label,
          track.readyState,
          track.enabled,
          track.muted
        );
        // Explicitly ensure enabled
        track.enabled = true;
      });
    } catch (e) {
      console.error('CallService: Error getting user media', e);
      throw e;
    }
  }

  private setupPeerConnection(callId: string) {
    this.peerConnection = new RTCPeerConnection(this.servers);

    this.peerConnection.oniceconnectionstatechange = () => {
      const state = this.peerConnection?.iceConnectionState;
      console.log('CallService: ICE Connection State Change:', state);
      if (state === 'failed' || state === 'disconnected') {
        console.warn(
          'CallService: Peer connection failed/disconnected. Check firewall/network.'
        );
      }
      if (state === 'connected') {
        console.log('CallService: P2P Connection Established!');
      }
    };

    this.peerConnection.onicecandidateerror = (event: any) => {
      console.error(
        'CallService: ICE Candidate Error:',
        event.errorCode,
        event.errorText,
        event.url
      );
    };

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        console.log(
          'CallService: Generated ICE Candidate:',
          event.candidate.type,
          event.candidate.address
        );
        // We need to know if we are the caller or callee to put candidates in the right place.
        // A simple heuristic: if we created the offer, we are the caller -> 'offerCandidates'
        // If we created the answer, we are the callee -> 'answerCandidates'

        // HOWEVER, onicecandidate might fire before we even set the local description fully or established role clearly in state.
        // But usually it fires after setLocalDescription.

        let candidateCollection = 'offerCandidates'; // Default
        if (this.peerConnection?.localDescription) {
          if (this.peerConnection.localDescription.type === 'answer') {
            candidateCollection = 'answerCandidates';
          }
        }

        const candidatesRef = collection(
          this.db,
          'calls',
          callId,
          candidateCollection
        );
        addDoc(candidatesRef, event.candidate.toJSON());
      }
    };

    this.peerConnection.ontrack = (event) => {
      console.log('CallService: Received remote track', event.streams[0]);
      // Use the stream provided by the event
      const stream = event.streams[0];
      this.remoteStream = stream;
      this.remoteStream$.next(stream);
    };
  }

  // --- Listening for Incoming Calls ---
  listenForIncomingCalls(conversationId: string) {
    // Clean up previous listener
    if (this.callDocSubscription) {
      // Careful: callDocSubscription is reused for active calls.
      // We need a separate listener for global incoming?
      // Or we only listen when idle.
    }

    const callsRef = collection(this.db, 'calls');
    const q = query(
      callsRef,
      where('conversationId', '==', conversationId),
      where('status', '==', 'offering'),
      limit(1)
    );

    return onSnapshot(q, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          const data = change.doc.data() as WebRTCCall;
          data.id = change.doc.id;
          this.incomingCall$.next(data);
        }
        if (change.type === 'removed') {
          this.incomingCall$.next(null);
        }
      });
    });
  }

  listenForAllIncomingCalls() {
    const callsRef = collection(this.db, 'calls');
    const q = query(callsRef, where('status', '==', 'offering'), limit(1));

    return onSnapshot(q, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          const data = change.doc.data() as WebRTCCall;
          data.id = change.doc.id;
          this.incomingCall$.next(data);
        }
        if (change.type === 'removed') {
          this.incomingCall$.next(null);
        }
      });
    });
  }

  toggleMic(muted: boolean) {
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((track) => {
        track.enabled = !muted;
      });
    }
  }

  // Not all browsers support setSinkId (mainly Chrome desktop)
  // We return true if executed, false if not supported
  async setAudioOutput(
    deviceId: string,
    audioElement: HTMLMediaElement
  ): Promise<boolean> {
    if ('setSinkId' in audioElement) {
      try {
        await (audioElement as any).setSinkId(deviceId);
        console.log(`Audio output set to ${deviceId}`);
        return true;
      } catch (error) {
        console.error('Error setting audio output:', error);
        return false;
      }
    }
    console.warn('setSinkId not supported in this browser.');
    return false;
  }
}
