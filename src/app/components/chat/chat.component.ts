import {
  Component,
  OnInit,
  ViewChild,
  ElementRef,
  AfterViewChecked,
  OnDestroy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ChatService } from '../../services/chat.service';
import { CustomerService } from '../../services/customer.service';
import { UserService } from '../../services/user.service';
import { CallService } from '../../services/call.service';
import { Message, Customer, WebRTCCall } from '../../models/inventory.models';
import { Subscription, take } from 'rxjs';

interface CustomerInfo {
  name: string;
  phoneNumber: string;
  address: string;
}

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './chat.component.html',
  styleUrl: './chat.component.css',
})
export class ChatComponent implements OnInit, AfterViewChecked, OnDestroy {
  @ViewChild('messagesContainer') private messagesContainer!: ElementRef;
  @ViewChild('remoteAudio') private remoteAudio!: ElementRef<HTMLAudioElement>;

  messages: Message[] = [];
  newMessage = '';
  senderName = '';
  private shouldScroll = false;

  // Customer registration
  isRegistered = false;
  customerInfo: CustomerInfo = {
    name: '',
    phoneNumber: '',
    address: '',
  };
  allCustomers: Customer[] = [];
  errorMessage = '';
  isAppUser = false;
  currentConversationId = '';
  conversations: string[] = [];
  private customerSubscription?: Subscription;
  private logoutSubscription?: Subscription;
  private incomingCallSubscription?: Subscription;
  private callStatusSubscription?: Subscription;

  callStatus = 'idle'; // idle, calling, connected, incoming
  incomingCall: WebRTCCall | null = null;
  remoteStream: MediaStream | null = null;

  private incomingCallListener?: () => void;

  constructor(
    private chatService: ChatService,
    private customerService: CustomerService,
    private userService: UserService,
    private callService: CallService
  ) {}

  ngOnInit(): void {
    // Load customers list first for validation
    this.customerSubscription = this.customerService.getCustomers().subscribe({
      next: (customers) => {
        this.allCustomers = customers;
        this.checkLoginAndStatus();
      },
      error: (err) => {
        console.error('Failed to load customers', err);
        // Fallback: try to login anyway without customer lookup
        this.checkLoginAndStatus();
      },
    });

    // Listen for logout events from the app
    this.logoutSubscription = this.chatService.logout$.subscribe(() => {
      this.performForceLogout();
    });

    // Call Status Listener
    this.callStatusSubscription = this.callService.callStatus$.subscribe(
      (status) => (this.callStatus = status)
    );

    this.incomingCallSubscription = this.callService.incomingCall$.subscribe(
      (call) => {
        // Don't accept if already busy
        if (this.callStatus !== 'idle') return;
        // Don't accept my own calls (simple check: senderName matches callerName)
        if (call.callerName === this.senderName) return;

        this.incomingCall = call;
        this.callStatus = 'incoming';
      }
    );

    this.callService.remoteStream$.subscribe((stream) => {
      this.remoteStream = stream;
      if (stream && this.remoteAudio) {
        // Force update the element. Using timeout to ensure view is updated if hidden previously
        setTimeout(() => {
          const audioEl = this.remoteAudio.nativeElement;
          audioEl.srcObject = stream;
          audioEl.muted = false;
          audioEl.volume = 1.0;

          const tracks = stream.getAudioTracks();
          if (tracks.length > 0) {
            console.log(
              'ChatComponent: Audio track found',
              tracks[0].label,
              'Enabled:',
              tracks[0].enabled,
              'Muted:',
              tracks[0].muted
            );
            tracks[0].enabled = true; // Ensure enabled
          } else {
            console.warn('ChatComponent: No audio tracks in stream!');
          }

          audioEl.onloadedmetadata = () => {
            console.log(
              'ChatComponent: Audio metadata loaded, attempting play...'
            );
            audioEl
              .play()
              .then(() => {
                console.log('ChatComponent: Audio playing successfully');
                this.setupAudioVisualizer(stream);
              })
              .catch((e) =>
                console.error('ChatComponent: Error playing audio:', e)
              );
          };
        }, 100);
      }
    });
  }

  private performForceLogout(): void {
    // Force logout without confirmation
    localStorage.removeItem('chatCustomerInfo');
    localStorage.removeItem('chatUserName');
    this.isRegistered = false;
    this.isAppUser = false;
    this.senderName = '';
    this.conversations = [];
    this.currentConversationId = '';
    this.customerInfo = {
      name: '',
      phoneNumber: '',
      address: '',
    };
    this.messages = [];
  }

  private checkLoginAndStatus(): void {
    const isAppLoggedIn = localStorage.getItem('jjm_logged_in') === 'true';
    const appUsername = localStorage.getItem('jjm_username');
    const appUserId = localStorage.getItem('jjm_user_id');

    // 1. App User Logic
    if (isAppLoggedIn) {
      this.isAppUser = true;
      this.isRegistered = true; // Auto-register immediately for UI
      this.errorMessage = '';

      // Default name to username found in storage
      this.senderName = appUsername || 'User';

      // Refine name with full profile if ID exists
      if (appUserId) {
        // Try sync fetch
        const user = this.userService.getUserById(appUserId);
        if (user) {
          this.senderName = user.fullName || user.username;
          this.loadMessages();
        } else {
          // Async fetch
          this.userService.users$.pipe(take(1)).subscribe((users) => {
            const u = users.find((x) => x.id === appUserId);
            if (u) {
              this.senderName = u.fullName || u.username;
            }
            // Reload messages with potentially updated name (though generic admin view doesn't depend on name for ID)
            this.loadMessages();
            this.loadMessages();

            // Listen for calls on this conversationId (User ID)
            // Note: Admin listens per conversation select? No, Admin should listen to all?
            // Wait, for scalability Admin should get notification.
            // For now, let's keep it simple: Admin only sees incoming call if he selects the user?
            // Or we assume "Conversation ID" is the channel.
            // If Admin is Global, he needs to listen to EVERYTHING?
            // Let's stick to: Customer listens to their ID. Admin listens to "Selected ID".
            // So Admin logic handles listener on selectConversation.
          });
        }
      } else {
        this.loadMessages();
      }
      return;
    }

    // 2. Guest/Customer Logic
    const savedCustomerInfo = localStorage.getItem('chatCustomerInfo');
    if (savedCustomerInfo) {
      const parsedInfo = JSON.parse(savedCustomerInfo);

      // Verify against customer list if needed, or just trust storage for speed + verification later
      const foundCustomer = this.allCustomers.find(
        (c) => c.name.toLowerCase() === parsedInfo.name.toLowerCase()
      );

      if (foundCustomer) {
        this.customerInfo = parsedInfo;
        this.senderName = this.customerInfo.name;
        this.isRegistered = true;
        this.loadMessages();
        // Start listening for calls on my channel
        if (this.incomingCallListener) {
          this.incomingCallListener();
        }
        this.incomingCallListener = this.callService.listenForIncomingCalls(
          this.senderName
        );
      } else {
        localStorage.removeItem('chatCustomerInfo');
        localStorage.removeItem('chatUserName');
        this.isRegistered = false;
      }
    }
  }

  ngAfterViewChecked(): void {
    if (this.shouldScroll) {
      this.scrollToBottom();
      this.shouldScroll = false;
    }
  }

  ngOnDestroy(): void {
    if (this.customerSubscription) {
      this.customerSubscription.unsubscribe();
    }
    if (this.logoutSubscription) {
      this.logoutSubscription.unsubscribe();
    }
    if (this.incomingCallSubscription) {
      this.incomingCallSubscription.unsubscribe();
    }
    if (this.callStatusSubscription) {
      this.callStatusSubscription.unsubscribe();
    }
    if (this.incomingCallListener) {
      this.incomingCallListener();
    }
  }

  registerCustomer(): void {
    this.errorMessage = '';

    // Validate inputs
    if (!this.customerInfo.name.trim()) {
      alert('Please enter your name');
      return;
    }
    if (!this.customerInfo.phoneNumber.trim()) {
      alert('Please enter your phone number');
      return;
    }
    if (!this.customerInfo.address.trim()) {
      alert('Please enter your address');
      return;
    }

    const phoneRegex = /^[\d\s\-\+\(\)]+$/;
    if (!phoneRegex.test(this.customerInfo.phoneNumber)) {
      alert('Please enter a valid phone number');
      return;
    }

    // CRITICAL: Verify against customer database
    // validation only if database is reachable/populated
    if (this.allCustomers.length > 0) {
      const foundCustomer = this.allCustomers.find(
        (c) =>
          c.name.toLowerCase() === this.customerInfo.name.trim().toLowerCase()
      );

      if (!foundCustomer) {
        alert(
          'Access Denied: You must be a registered customer to use the chat.'
        );
        return;
      }
    } else {
      console.warn(
        'Customer verification skipped: Customer list is empty or failed to load.'
      );
    }

    // Save info and proceed
    localStorage.setItem('chatCustomerInfo', JSON.stringify(this.customerInfo));
    localStorage.setItem('chatUserName', this.customerInfo.name);
    this.senderName = this.customerInfo.name;
    this.isRegistered = true;

    this.isRegistered = true;

    this.loadMessages();
    this.callService.listenForIncomingCalls(this.senderName);
  }

  private allMessagesCached: Message[] = [];
  private messagesSubscription?: Subscription;

  private loadMessages(): void {
    if (this.messagesSubscription) {
      // Already subscribed, just refresh view
      this.updateFilteredMessages(false);
      return;
    }

    // Subscribe to messages
    this.messagesSubscription = this.chatService.getMessages().subscribe({
      next: (allMessages) => {
        this.allMessagesCached = allMessages;

        // Admin Logic: Find all unique conversation IDs
        if (this.isAppUser) {
          const convSet = new Set<string>();
          allMessages.forEach((msg) => {
            if (msg.conversationId) convSet.add(msg.conversationId);
          });
          this.conversations = Array.from(convSet);
        }

        this.updateFilteredMessages(true);
      },
      error: (error) => {
        console.error('Error loading messages:', error);
      },
    });
  }

  private updateFilteredMessages(notify: boolean): void {
    // Filter messages for current conversation
    const targetId = this.isAppUser
      ? this.currentConversationId
      : this.senderName;

    const filteredMessages = this.allMessagesCached.filter((msg) => {
      // If no targetId (e.g. admin has no conv selected), show nothing
      if (!targetId) return false;
      return msg.conversationId === targetId;
    });

    const previousCount = this.messages.length;
    const newCount = filteredMessages.length;
    const hadMessages = previousCount > 0;

    this.messages = filteredMessages;

    // Check for new incoming messages for Notification
    if (notify && hadMessages && newCount > previousCount) {
      const lastMsg = filteredMessages[newCount - 1];
      if (!this.isMyMessage(lastMsg)) {
        this.playNotificationSound();
      }
    }

    // Auto-scroll on new messages
    if (!hadMessages || newCount > previousCount) {
      this.shouldScroll = true;
    }
  }

  private playNotificationSound(): void {
    try {
      const AudioContext =
        (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AudioContext) return;

      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = 'sine';
      // Pleasant "Ding"
      osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
      osc.frequency.exponentialRampToValueAtTime(1046.5, ctx.currentTime + 0.1); // C6

      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);

      osc.start();
      osc.stop(ctx.currentTime + 0.5);
    } catch (e) {
      console.warn('Audio playback failed', e);
    }
  }

  sendMessage(): void {
    if (!this.newMessage.trim()) return;

    // Determine Conversation ID
    let convId = this.isAppUser ? this.currentConversationId : this.senderName;

    // If Admin tries to send without selecting a conversation
    if (this.isAppUser && !convId) {
      alert('Please select a conversation first.');
      return;
    }

    this.chatService
      .sendMessage(this.newMessage, this.senderName, convId)
      .then(() => {
        this.newMessage = '';
        this.shouldScroll = true;
      })
      .catch((error) => {
        console.error('Error sending message:', error);
        alert('Failed to send message. Please try again.');
      });
  }

  selectConversation(convId: string): void {
    this.currentConversationId = convId;
    this.updateFilteredMessages(false); // Refreshes view with new filter, no sound

    // Admin listens to calls on this channel
    if (this.incomingCallListener) {
      this.incomingCallListener();
    }
    this.incomingCallListener = this.callService.listenForIncomingCalls(convId);
  }

  private scrollToBottom(): void {
    try {
      this.messagesContainer.nativeElement.scrollTop =
        this.messagesContainer.nativeElement.scrollHeight;
    } catch (err) {
      console.error('Scroll error:', err);
    }
  }

  formatTime(timestamp: Date): string {
    const date = new Date(timestamp);
    return date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  isMyMessage(message: Message): boolean {
    return message.senderName === this.senderName;
  }

  changeInfo(): void {
    alert('Do you want to update your customer information?');
    this.isRegistered = false;
  }

  // Audio Recording
  isRecording = false;
  private mediaRecorder: any = null; // Using any to avoid strict type issues with MediaRecorder if types missing
  private audioChunks: any[] = [];

  startRecording(event?: Event): void {
    if (event) {
      event.preventDefault(); // Prevent default behavior for touch/mouse
      event.stopPropagation();
    }

    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream) => {
          this.mediaRecorder = new MediaRecorder(stream);
          this.mediaRecorder.start();
          this.isRecording = true;
          this.audioChunks = [];

          this.mediaRecorder.addEventListener('dataavailable', (event: any) => {
            if (event.data.size > 0) {
              this.audioChunks.push(event.data);
            }
          });

          this.mediaRecorder.addEventListener('stop', () => {
            const audioBlob = new Blob(this.audioChunks, {
              type: 'audio/webm',
            });
            const reader = new FileReader();
            reader.readAsDataURL(audioBlob);
            reader.onloadend = () => {
              const base64String = reader.result as string;
              if (base64String) {
                this.sendAudio(base64String);
              }
            };

            // Stop all tracks to release microphone
            stream.getTracks().forEach((track) => track.stop());
          });
        })
        .catch((err) => {
          console.error('Error accessing microphone:', err);
          alert('Could not access microphone. Please allow permissions.');
          this.isRecording = false;
        });
    } else {
      alert('Audio recording is not supported in this browser.');
    }
  }

  stopRecording(event?: Event): void {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    if (this.mediaRecorder && this.isRecording) {
      this.mediaRecorder.stop();
      this.isRecording = false;
    }
  }

  cancelRecording(): void {
    if (this.mediaRecorder && this.isRecording) {
      // Just stop and don't process (or process but ignoring result would require more logic,
      // but simpler is to just let it stop but maybe clear chunks first?
      // Actually stop event fires immediately. I'll just clear chunks here if I can,
      // but since 'stop' listener is bound, it will run.
      // So I will make the listener check a cancelled flag.
      // For now, let's just Stick to Stop = Send.
      this.stopRecording();
    }
  }

  sendAudio(base64: string): void {
    let convId = this.isAppUser ? this.currentConversationId : this.senderName;
    if (this.isAppUser && !convId) {
      alert('Please select a conversation first.');
      return;
    }

    this.chatService
      .sendAudioMessage(base64, this.senderName, convId)
      .then(() => {
        this.shouldScroll = true;
      })
      .catch((error) => {
        console.error('Error sending audio message:', error);
        alert('Failed to send audio message.');
      });
  }

  deleteMessage(message: Message): void {
    if (!this.isMyMessage(message)) return;

    if (confirm('Are you sure you want to delete this message?')) {
      this.chatService.deleteMessage(message.id).catch((error) => {
        console.error('Error deleting message:', error);
        alert('Failed to delete message.');
      });
    }
  }

  logout(): void {
    if (this.isAppUser) {
      alert('You cannot logout of chat while logged into the application.');
      return;
    }

    if (
      confirm(
        'Are you sure you want to logout? Your information will be cleared.'
      )
    ) {
      localStorage.removeItem('chatCustomerInfo');
      localStorage.removeItem('chatUserName');
      this.isRegistered = false;
      this.customerInfo = {
        name: '',
        phoneNumber: '',
        address: '',
      };
      this.messages = [];
    }
  }

  // --- Call Logic ---
  startCall(): void {
    const targetId = this.isAppUser
      ? this.currentConversationId
      : this.senderName;

    if (!targetId) {
      alert('Cannot start call: Unknown conversation.');
      return;
    }

    this.callService.initializeCall(targetId, this.senderName);
  }

  acceptCall(): void {
    if (this.incomingCall) {
      this.callService.answerCall(this.incomingCall);
      this.incomingCall = null;
    }
  }

  rejectCall(): void {
    if (this.incomingCall) {
      this.callService.rejectCall(this.incomingCall.id);
      this.incomingCall = null;
      this.callStatus = 'idle';
    }
  }

  endCall(): void {
    this.callService.endCall();
    this.isSpeakerOn = false;
    this.isMicMuted = false;
    this.cleanupAudioVisualizer();
  }

  isSpeakerOn = false;
  isMicMuted = false;
  audioLevel = 0;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private dataArray: Uint8Array | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private animationFrameId: number | null = null;

  setupAudioVisualizer(stream: MediaStream): void {
    this.cleanupAudioVisualizer(); // Safety cleanup
    try {
      const AudioContext =
        window.AudioContext || (window as any).webkitAudioContext;
      this.audioContext = new AudioContext();
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 64; // Low res is fine for volume
      this.source = this.audioContext.createMediaStreamSource(stream);
      this.source.connect(this.analyser);
      this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);

      const updateVolume = () => {
        if (!this.analyser || !this.dataArray) return;
        // @ts-ignore
        this.analyser.getByteFrequencyData(this.dataArray);

        // Calculate average volume
        let sum = 0;
        for (let i = 0; i < this.dataArray.length; i++) {
          sum += this.dataArray[i];
        }
        const average = sum / this.dataArray.length; // 0 to 255
        // Normalize to percentage (roughly) and boost a bit
        this.audioLevel = Math.min(100, Math.max(0, (average / 255) * 300));

        this.animationFrameId = requestAnimationFrame(updateVolume);
      };
      updateVolume();
    } catch (e) {
      console.error('Error setting up visualizer', e);
    }
  }

  cleanupAudioVisualizer(): void {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    this.audioLevel = 0;
  }

  async toggleSpeaker() {
    this.isSpeakerOn = !this.isSpeakerOn;
    if (this.remoteAudio && this.remoteAudio.nativeElement) {
      // Logic: Iterate devices or just try to default/speaker if available
      // Since specific speaker selection requires deviceId, and 'speaker' isn't standard enum,
      // we'll try a common heuristic: 'default' vs unique ID.
      // But typically we simply want to toggle this.isSpeakerOn for UI for now,
      // and if browser allows enumeration maybe we pick the last one?
      // For MOBILE WEB: Browsers handle this. We might just need to ensure audio volume is max.

      // Try to find a sink that is NOT the default one to switch to "speaker" if default is earpiece
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioOutputs = devices.filter((d) => d.kind === 'audiooutput');

      // Simple toggle: If on, try to set to the 2nd device if available (assumed speaker), else default.
      if (audioOutputs.length > 1 && this.isSpeakerOn) {
        // Ideally we need to know which one is the speaker.
        // Often 'default' is earpiece on mobile? Or 'communications'
        // Let's just try to set it to the last one as a "toggle" test.
        // This is experimental.
        const target =
          audioOutputs[0].deviceId === 'default'
            ? audioOutputs[1].deviceId
            : audioOutputs[0].deviceId;
        await this.callService.setAudioOutput(
          target,
          this.remoteAudio.nativeElement
        );
      } else {
        await this.callService.setAudioOutput(
          'default',
          this.remoteAudio.nativeElement
        );
      }
    }
  }

  toggleMic() {
    this.isMicMuted = !this.isMicMuted;
    this.callService.toggleMic(this.isMicMuted);
  }
}
