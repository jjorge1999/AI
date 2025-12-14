import {
  Component,
  OnInit,
  ViewChild,
  ElementRef,
  AfterViewChecked,
  OnDestroy,
  HostListener,
  Input,
  OnChanges,
  SimpleChanges,
  Output,
  EventEmitter,
  signal,
  computed,
  WritableSignal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ChatService, UserStatus } from '../../services/chat.service';
import { CustomerService } from '../../services/customer.service';
import { UserService } from '../../services/user.service';
import { CallService } from '../../services/call.service';
import { AiService } from '../../services/ai.service';
import { DialogService } from '../../services/dialog.service';
import {
  Message,
  Sale,
  Customer,
  WebRTCCall,
  User,
} from '../../models/inventory.models';
import { InventoryService } from '../../services/inventory.service';
import { Subscription, take } from 'rxjs';
import { Unsubscribe } from 'firebase/firestore';

interface CustomerInfo {
  name: string;
  phoneNumber: string;
  address: string;
  gpsCoordinates?: string;
}

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './chat.component.html',
  styleUrl: './chat.component.css',
})
export class ChatComponent
  implements OnInit, AfterViewChecked, OnDestroy, OnChanges
{
  @ViewChild('messagesContainer') private messagesContainer!: ElementRef;
  @ViewChild('remoteAudio') private remoteAudio!: ElementRef<HTMLAudioElement>;

  messages: Message[] = [];
  newMessage = '';
  senderName = '';
  @Input() isOpen = false;
  @Output() totalUnreadCountChange = new EventEmitter<number>();
  isLocationReadOnly = true;
  private shouldScroll = false;

  // Cache for resolving IDs/names to Full Names
  private userNamesCache = new Map<string, string>();
  private userAddressesCache = new Map<string, string>();
  private userGpsCache = new Map<string, string>();

  // Customer registration
  isRegistered = false;
  customerInfo: CustomerInfo = {
    name: '',
    phoneNumber: '',
    address: 'N/A',
    gpsCoordinates: 'N/A',
  };
  allCustomers: Customer[] = [];
  errorMessage = '';
  isAppUser = false;
  currentConversationId = '';
  conversations: string[] = [];
  private subscriptions: Subscription = new Subscription();

  callStatus = 'idle'; // idle, calling, connected, incoming
  incomingCall: WebRTCCall | null = null;
  remoteStream: MediaStream | null = null;

  private incomingCallListener?: Subscription | Unsubscribe;

  private notificationAudioContext: AudioContext | null = null;
  private audioUnlocked = false;

  // Online Status - Signals
  onlineUsers = signal<UserStatus[]>([]);
  currentTime = signal(Date.now());

  suggestedReplies: string[] = [];

  // Computed Support Status
  isSupportOnline = computed(() => {
    const cutoff = this.currentTime() - 2 * 60 * 1000;
    return this.onlineUsers().some(
      (u) => u.role === 'admin' && u.lastSeen.getTime() > cutoff
    );
  });

  private heartbeatInterval: any = null;

  currentUser?: User;
  isGeneratingFollowUp = false;

  constructor(
    private chatService: ChatService,
    private customerService: CustomerService,
    private userService: UserService,
    private callService: CallService,
    private aiService: AiService,
    private inventoryService: InventoryService,
    private dialogService: DialogService
  ) {
    // Request notification permission immediately
    this.requestNotificationPermission();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen) {
      // Check for new or expired credentials when chat opens
      const savedCustomerInfo = localStorage.getItem('chatCustomerInfo');

      if (savedCustomerInfo && !this.isRegistered) {
        // Check if credentials exist and are valid
        try {
          const parsedInfo = JSON.parse(savedCustomerInfo);
          // Valid credentials found - trigger login check (no expiration for public chat)
          this.checkLoginAndStatus();
        } catch (e) {
          console.error('Error parsing chat credentials', e);
          // localStorage.removeItem('chatCustomerInfo');
          // localStorage.removeItem('chatUserName');
        }
      }

      // Chat opened, refresh view (this marks messages as read if logic allows)
      this.updateFilteredMessages(false);
      this.shouldScroll = true; // Ensure we scroll to bottom when opening
    }
  }

  private requestNotificationPermission() {
    if ('Notification' in window) {
      Notification.requestPermission();
    }
  }

  // Handle visibility changes to manage connection/status if needed
  @HostListener('document:visibilitychange')
  onVisibilityChange() {
    if (!document.hidden) {
      // Clear title notification if active
      document.title = 'JJM Inventory';
    }
  }

  // "Unlock" audio context on first user interaction (iOS requirement)
  // We play a silent buffer to force the audio subsystem to wake up.
  private unlockAudioContext() {
    if (this.audioUnlocked) return;

    if (!this.notificationAudioContext) {
      const AudioContext =
        (window as any).AudioContext || (window as any).webkitAudioContext;
      this.notificationAudioContext = new AudioContext();
    }

    const ctx = this.notificationAudioContext;
    if (ctx) {
      // 1. Resume
      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      // 2. Play silent buffer (The "Warm Up" trick for iOS)
      try {
        const buffer = ctx.createBuffer(1, 1, 22050);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.start(0);

        // If we get here without error, we assume it worked
        this.audioUnlocked = true;
        console.log(
          'ChatComponent: AudioContext unlocked via user interaction.'
        );
      } catch (e) {
        console.error('ChatComponent: Failed to unlock audio', e);
      }
    }
  }

  @HostListener('document:click')
  @HostListener('document:touchstart')
  @HostListener('document:keydown')
  onUserInteraction() {
    this.unlockAudioContext();
  }

  ngOnInit(): void {
    // Check login immediately
    this.checkLoginAndStatus();

    // Subscribe to online users
    this.subscriptions.add(
      this.chatService.getOnlineUsers().subscribe((users) => {
        console.log('Online Users Signal Update:', users.length);
        this.onlineUsers.set(users);
      })
    );

    // Subscribe to all users to set currentUser for permission checks
    this.subscriptions.add(
      this.userService.users$.subscribe((users) => {
        if (this.isAppUser) {
          const userId = localStorage.getItem('jjm_user_id');
          if (userId) {
            this.currentUser = users.find((u) => u.id === userId);
          }
        }
      })
    );

    // Update time signal every 15s
    setInterval(() => {
      this.currentTime.set(Date.now());
    }, 15000);

    // Listen for logout events from the app
    this.subscriptions.add(
      this.chatService.logout$.subscribe(() => {
        const isLoggedIn = localStorage.getItem('jjm_logged_in') === 'true';
        if (!isLoggedIn) {
          this.performForceLogout();
        }
      })
    );

    // Call Status Listener
    this.subscriptions.add(
      this.callService.callStatus$.subscribe((status) => {
        this.callStatus = status;
        if (status !== 'incoming') {
          this.stopRinging();
        }
      })
    );

    this.subscriptions.add(
      this.callService.incomingCall$.subscribe((call) => {
        if (!call) {
          if (this.callStatus === 'incoming') {
            this.incomingCall = null;
            this.callStatus = 'idle';
            this.stopRinging();
          }
          return;
        }

        // Don't accept if already busy
        if (this.callStatus !== 'idle') return;
        // Don't accept my own calls (simple check: senderName matches callerName)
        if (call.callerName === this.senderName) return;

        this.incomingCall = call;
        this.callStatus = 'incoming';
        this.startRinging();
      })
    );

    this.subscriptions.add(
      this.callService.remoteStream$.subscribe((stream) => {
        this.remoteStream = stream;
        if (stream && this.remoteAudio) {
          // Force update the element. Using timeout to ensure view is updated if hidden previously
          // Note: Timeouts inside subscriptions are tricky but this is a one-off delay for DOM.
          // We'll leave it but ideally it should be destroyed if component dies.
          // Since it's 100ms it's likely fine, but to be 100% safe against detached nodes:
          const timer = setTimeout(() => {
            if (!this.remoteAudio) return; // Guard
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
              if (audioEl.play) {
                audioEl
                  .play()
                  .then(() => {
                    console.log('ChatComponent: Audio playing successfully');
                    this.setupAudioVisualizer(stream);
                  })
                  .catch((e) =>
                    console.error('ChatComponent: Error playing audio:', e)
                  );
              }
            };
          }, 100);
          // No easy way to store this specific timer ID without cluttering, but 100ms is very short.
        }
      })
    );

    // Listen for Call Errors
    this.subscriptions.add(
      this.callService.error$.subscribe((err) => {
        this.dialogService.error('Call Failed: ' + err).subscribe();
        this.callStatus = 'idle';
        this.stopRinging();
      })
    );
  }

  private performForceLogout(): void {
    // Force logout without confirmation
    // localStorage.removeItem('chatCustomerInfo');
    // localStorage.removeItem('chatUserName');
    this.isRegistered = false;
    this.isAppUser = false;
    this.senderName = '';
    this.conversations = [];
    this.currentConversationId = '';
    this.customerInfo = {
      name: '',
      phoneNumber: '',
      address: 'N/A',
      gpsCoordinates: 'N/A',
    };
    this.messages = [];
    this.stopHeartbeat();
  }

  private startHeartbeat(): void {
    this.stopHeartbeat(); // Clear existing
    if (!this.senderName) return;

    const id = this.isAppUser
      ? localStorage.getItem('jjm_user_id') || this.senderName
      : this.senderName;
    const role = this.isAppUser ? 'admin' : 'customer';

    // Initial update
    this.chatService.updatePresence(id, this.senderName, role).subscribe();

    // Periodically update
    this.heartbeatInterval = setInterval(() => {
      if (this.senderName) {
        const uid = this.isAppUser
          ? localStorage.getItem('jjm_user_id') || this.senderName
          : this.senderName;
        this.chatService.updatePresence(uid, this.senderName, role).subscribe();
      }
    }, 30000); // 30 seconds
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  // isSupportOnline is now a signal property

  isUserOnline(nameOrId: string): boolean {
    if (!nameOrId) return false;
    const cutoff = this.currentTime() - 2 * 60 * 1000;
    // Check by ID or Name
    return this.onlineUsers().some(
      (u) =>
        (u.id === nameOrId || u.name === nameOrId) &&
        u.lastSeen.getTime() > cutoff
    );
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

      // Use stored full name from localStorage (set during login)
      const appFullName = localStorage.getItem('jjm_fullname');
      this.senderName = appFullName || appUsername || 'User';

      // Load messages immediately
      this.loadMessages();

      // For Admin, load both customers and users for conversation resolution
      if (this.allCustomers.length === 0) {
        this.customerService.loadCustomers();
        this.subscriptions.add(
          this.customerService.getCustomers().subscribe((customers) => {
            this.allCustomers = customers;
          })
        );
      }

      // Load users to resolve conversation names/addresses/GPS
      this.userService.loadUsers();

      // Start global listener for Admin to hear all incoming calls
      if (this.incomingCallListener) {
        // @ts-ignore
        typeof this.incomingCallListener === 'function'
          ? this.incomingCallListener()
          : this.incomingCallListener.unsubscribe();
      }
      this.incomingCallListener = this.callService.listenForAllIncomingCalls();

      this.startHeartbeat();
      return;
    }

    // 2. Guest/Customer Logic
    const savedCustomerInfo = localStorage.getItem('chatCustomerInfo');
    if (savedCustomerInfo) {
      const parsedInfo = JSON.parse(savedCustomerInfo);

      // No expiration check - customers stay logged in until explicit logout
      // Trust localStorage and auto-login immediately
      this.customerInfo = parsedInfo;
      this.senderName = this.customerInfo.name;
      this.isRegistered = true;

      // CRITICAL: Reload Inventory Service to fetch customer's sales data
      this.inventoryService.reloadData();

      this.loadMessages();

      // Start listening for calls on my channel
      if (this.incomingCallListener) {
        // @ts-ignore
        typeof this.incomingCallListener === 'function'
          ? this.incomingCallListener()
          : this.incomingCallListener.unsubscribe();
      }
      this.incomingCallListener = this.callService.listenForIncomingCalls(
        this.senderName
      );

      this.startHeartbeat();

      // Optional: Verify against customer list in background (non-blocking)
      const foundCustomer = this.allCustomers.find(
        (c) => c.phoneNumber === parsedInfo.phoneNumber
      );
      if (!foundCustomer) {
        console.log(
          'Customer not yet in database, but logged in via localStorage'
        );
      }
    } else {
      // No saved info, new guest
      this.getLocation(true);
    }
  }

  ngAfterViewChecked(): void {
    if (this.shouldScroll) {
      this.scrollToBottom();
      this.shouldScroll = false;
    }
  }

  ngOnDestroy(): void {
    // Stop any active ringing
    this.stopRinging();
    this.stopHeartbeat();

    // Clean up visualization audio context
    this.cleanupAudioVisualizer();

    // Clean up notification audio context
    if (this.notificationAudioContext) {
      this.notificationAudioContext.close().catch(() => {});
      this.notificationAudioContext = null;
    }

    this.subscriptions.unsubscribe();

    if (this.incomingCallListener) {
      // @ts-ignore
      typeof this.incomingCallListener === 'function'
        ? this.incomingCallListener()
        : this.incomingCallListener.unsubscribe();
    }
  }

  registerCustomer(): void {
    this.errorMessage = '';

    // Validate inputs
    if (!this.customerInfo.name.trim()) {
      this.dialogService.warning('Please enter your name').subscribe();
      return;
    }
    if (!this.customerInfo.phoneNumber.trim()) {
      this.dialogService.warning('Please enter your phone number').subscribe();
      return;
    }
    if (!this.customerInfo.address.trim()) {
      this.dialogService.warning('Please enter your address').subscribe();
      return;
    }

    const phoneRegex = /^[\d\s\-\+\(\)]+$/;
    if (!phoneRegex.test(this.customerInfo.phoneNumber)) {
      this.dialogService
        .warning('Please enter a valid phone number')
        .subscribe();
      return;
    }

    // CRITICAL: Verify against customer database
    // validation only if database is reachable/populated
    // Verify against database securely
    this.customerService.getCustomerByName(this.customerInfo.name).subscribe({
      next: (matches) => {
        const foundCustomer = matches.find(
          (c) =>
            c.name.toLowerCase() === this.customerInfo.name.trim().toLowerCase()
        );

        if (!foundCustomer) {
          this.dialogService
            .error(
              'Access Denied: You must be a registered customer to use the chat.'
            )
            .subscribe();
          return;
        }

        // Validate Phone Number (Last 8 Digits)
        const cleanInput = this.customerInfo.phoneNumber
          .replace(/\D/g, '')
          .slice(-8);
        const cleanStored = (foundCustomer.phoneNumber || '')
          .replace(/\D/g, '')
          .slice(-8);

        if (cleanInput !== cleanStored) {
          this.dialogService
            .error(
              'Verification Failed: The phone number provided does not match our records.'
            )
            .subscribe();
          return;
        }

        // Save info and proceed
        // Merge DB data into local state (but keep user's original input for phone/address)
        this.customerInfo = {
          ...this.customerInfo,
          ...foundCustomer,
          // Keep the user's original input for these fields (DB returns masked data)
          phoneNumber: this.customerInfo.phoneNumber,
          address: this.customerInfo.address,
        };

        // Store customer data with UNMASKED phone/address (user's original input)
        const infoToStore = {
          ...foundCustomer,
          phoneNumber: this.customerInfo.phoneNumber, // User's original input
          deliveryAddress: this.customerInfo.address, // User's original input
          address: this.customerInfo.address, // For backwards compatibility
        };
        localStorage.setItem('chatCustomerInfo', JSON.stringify(infoToStore));
        localStorage.setItem('chatUserName', foundCustomer.name);

        // Store IDs for linkage
        if (foundCustomer.id) {
          localStorage.setItem('customer_id', foundCustomer.id);
        }
        if (foundCustomer.userId) {
          localStorage.setItem('jjm_user_id', foundCustomer.userId);
        }
        this.senderName = this.customerInfo.name;
        this.isRegistered = true;
        this.errorMessage = '';

        // CRITICAL: Reload Inventory Service to switch to Customer Mode (query by customerId)
        this.inventoryService.reloadData();

        this.loadMessages();
        if (this.incomingCallListener) {
          // @ts-ignore
          typeof this.incomingCallListener === 'function'
            ? this.incomingCallListener()
            : this.incomingCallListener.unsubscribe();
        }
        this.incomingCallListener = this.callService.listenForIncomingCalls(
          this.senderName
        );
      },
      error: (err) => {
        console.error('Verification failed', err);
        this.dialogService
          .error('Verification error. Please try again.')
          .subscribe();
      },
    });
  }

  private allMessagesCached: Message[] = [];
  // private messagesSubscription?: Subscription; // Removed

  unreadCounts: { [key: string]: number } = {};
  private conversationMessageCounts: { [key: string]: number } = {};

  // Audio/Call States
  isSpeakerOn = false;
  isMicMuted = false;
  audioLevel = 0;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private dataArray: Uint8Array | null = null;
  private animationFrameId: number | null = null;

  private notifyUser(message: Message): void {
    if (this.isMyMessage(message)) return;

    this.playNotificationSound();

    if (
      document.hidden &&
      'Notification' in window &&
      Notification.permission === 'granted'
    ) {
      new Notification('New Message', {
        body: message.text || 'You received a new audio message',
        icon: '/assets/logo.png',
      });
      document.title = `New Message from ${message.senderName}`;
    }
  }

  private loadMessages(): void {
    // Avoid double subscription
    // Since we removed individual property, strict check is harder,
    // but this method is controlled by checkLoginAndStatus which runs once per init.

    this.subscriptions.add(
      this.chatService.getMessages().subscribe({
        next: (allMessages) => {
          this.allMessagesCached = allMessages;

          if (this.isAppUser) {
            const convMap = new Map<string, number>();
            const convSet = new Set<string>();
            const latestMsgMap = new Map<string, Message>();

            allMessages.forEach((msg) => {
              if (msg.conversationId) {
                convSet.add(msg.conversationId);
                convMap.set(
                  msg.conversationId,
                  (convMap.get(msg.conversationId) || 0) + 1
                );
                // Store latest message
                latestMsgMap.set(msg.conversationId, msg);
              }
            });

            this.conversations = Array.from(convSet);

            // Resolve names
            this.subscriptions.add(
              this.userService.users$.pipe(take(1)).subscribe((users) => {
                this.conversations.forEach((convId) => {
                  if (
                    !this.userNamesCache.has(convId) ||
                    !this.userAddressesCache.get(convId) ||
                    !this.userGpsCache.get(convId)
                  ) {
                    const user = users.find(
                      (u) =>
                        u.username === convId ||
                        u.fullName === convId ||
                        u.id === convId
                    );
                    if (user) {
                      this.userNamesCache.set(
                        convId,
                        user.fullName || user.username
                      );
                      this.userAddressesCache.set(convId, user.address || '');
                      this.userGpsCache.set(convId, user.gpsCoordinates || '');
                    } else {
                      const customer = this.allCustomers.find(
                        (c) => c.name === convId
                      );
                      if (customer) {
                        this.userNamesCache.set(convId, customer.name);
                        this.userAddressesCache.set(
                          convId,
                          customer.deliveryAddress
                        );
                        this.userGpsCache.set(
                          convId,
                          customer.gpsCoordinates || ''
                        );
                      } else {
                        this.userNamesCache.set(convId, convId);
                      }
                    }
                  }
                });
              })
            );

            // Detect new messages & Update unread counts
            this.conversations.forEach((convId) => {
              const currentCount = convMap.get(convId) || 0;
              const prevCount = this.conversationMessageCounts[convId] || 0;

              // Update unread count based on isRead flag
              this.unreadCounts[convId] = allMessages.filter(
                (m) =>
                  m.conversationId === convId &&
                  !m.isRead &&
                  !this.isMyMessage(m)
              ).length;

              if (currentCount > prevCount) {
                // Trigger notification for ANY new message in ANY conversation
                const lastMsg = latestMsgMap.get(convId);
                if (lastMsg) {
                  this.notifyUser(lastMsg);
                }
              }
              this.conversationMessageCounts[convId] = currentCount;
            });
          }

          // Calculate and Emit Total Unread
          let totalUnread = 0;
          if (this.isAppUser) {
            totalUnread = Object.values(this.unreadCounts).reduce(
              (a, b) => a + b,
              0
            );
          } else {
            totalUnread = allMessages.filter(
              (m) => !m.isRead && !this.isMyMessage(m)
            ).length;
          }
          this.totalUnreadCountChange.emit(totalUnread);

          this.updateFilteredMessages(!this.isAppUser);
        },
        error: (error) => {
          console.error('Error loading messages:', error);
        },
      })
    );
  }

  // Helper to get display name
  getDisplayName(convId: string): string {
    return this.userNamesCache.get(convId) || convId;
  }

  getUserAddress(convId: string): string {
    return this.userAddressesCache.get(convId) || '';
  }

  getUserGps(convId: string): string {
    return this.userGpsCache.get(convId) || '';
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

    // Mark unread messages as read if we are looking at them and chat is open
    if (this.isOpen && targetId) {
      const unreadIds = filteredMessages
        .filter((m) => !m.isRead && !this.isMyMessage(m))
        .map((m) => m.id);

      if (unreadIds.length > 0) {
        this.chatService.markAsRead(unreadIds);
      }
    }

    // Check for new incoming messages for Notification & AI Analysis
    if (hadMessages && newCount > previousCount) {
      const lastMsg = filteredMessages[newCount - 1];

      // Always Trigger AI Analysis for any new message in the current view (Admin Only)
      if (this.isAppUser && !this.isMyMessage(lastMsg) && lastMsg.text) {
        this.processIncomingMessage(lastMsg);
      }

      // Notification Logic (Sound/Popups) - Only if 'notify' is true
      if (notify && !this.isMyMessage(lastMsg)) {
        this.playNotificationSound();

        // System Notification if hidden
        if (
          document.hidden &&
          'Notification' in window &&
          Notification.permission === 'granted'
        ) {
          new Notification('New Message', {
            body: lastMsg.text || 'You received a new audio message',
            icon: '/assets/logo.png', // Ensure this exists or use default
          });
          document.title = `(${
            newCount - previousCount
          }) New Message - JJM Inventory`;
        }
      }
    }

    // Auto-scroll on new messages or if forced
    if (!hadMessages || newCount > previousCount) {
      this.shouldScroll = true;
      // Force scroll immediately after a tick to ensure DOM is ready
      setTimeout(() => this.scrollToBottom(), 100);
    }
  }

  private playNotificationSound(): void {
    try {
      // Use the unlocked context if available
      let ctx = this.notificationAudioContext;

      // Fallback if not initialized (rare if user interacted)
      if (!ctx) {
        const AudioContext =
          (window as any).AudioContext || (window as any).webkitAudioContext;
        if (AudioContext) {
          ctx = new AudioContext();
        }
      }

      if (!ctx) return;

      // Ensure it is running
      if (ctx.state === 'suspended') {
        return;
      }

      const now = ctx.currentTime;

      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = 'sine';
      osc2.type = 'sine';

      osc1.frequency.setValueAtTime(1200, now);
      osc2.frequency.setValueAtTime(2400, now);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.5, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.6);

      osc1.start(now);
      osc2.start(now);

      osc1.stop(now + 0.6);
      osc2.stop(now + 0.6);
    } catch (e) {
      console.warn('Audio playback failed', e);
    }
  }

  private ringInterval: any = null;

  private startRinging(): void {
    if (this.ringInterval) return; // Already ringing

    const playRing = () => {
      try {
        const AudioContext =
          (window as any).AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioContext();

        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(ctx.destination);

        // Standard US Ringtone frequencies
        osc1.frequency.value = 440;
        osc2.frequency.value = 480;

        // Modulate volume
        gain.gain.setValueAtTime(0, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.5, ctx.currentTime + 1.8);
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 2.0);

        osc1.start(ctx.currentTime);
        osc2.start(ctx.currentTime);

        osc1.stop(ctx.currentTime + 2);
        osc2.stop(ctx.currentTime + 2);

        // Cleanup context after ring duration
        setTimeout(() => {
          if (ctx.state !== 'closed') {
            ctx.close();
          }
        }, 2500);
      } catch (e) {
        console.warn('Ring playback failed', e);
      }
    };

    playRing();
    this.ringInterval = setInterval(playRing, 4000);
  }

  private stopRinging(): void {
    if (this.ringInterval) {
      clearInterval(this.ringInterval);
      this.ringInterval = null;
    }
  }

  sendMessage(): void {
    if (!this.newMessage.trim()) return;

    // Determine Conversation ID
    let convId = this.isAppUser ? this.currentConversationId : this.senderName;

    // If Admin tries to send without selecting a conversation
    if (this.isAppUser && !convId) {
      this.dialogService
        .warning('Please select a conversation first.')
        .subscribe();
      return;
    }

    const messageText = this.newMessage;

    this.chatService
      .sendMessage(this.newMessage, this.senderName, convId)
      .subscribe({
        next: () => {
          this.newMessage = '';
          this.suggestedReplies = []; // Clear suggestions after sending
          this.shouldScroll = true;

          // If customer, trigger AI auto-response for product inquiries
          if (!this.isAppUser) {
            this.handleCustomerInquiry(messageText);
          }
        },
        error: (error) => {
          console.error('Error sending message:', error);
          this.dialogService
            .error('Failed to send message. Please try again.')
            .subscribe();
        },
      });
  }

  // AI Auto-responder for customer product inquiries - Uses Gemma AI
  private async handleCustomerInquiry(messageText: string): Promise<void> {
    // Keywords that indicate a product inquiry (English, Filipino, Cebuano)
    const productKeywords = [
      // English
      'price',
      'cost',
      'how much',
      'available',
      'stock',
      'buy',
      'order',
      'product',
      'item',
      'do you have',
      'sell',
      'looking for',
      'interested',
      'want',
      'need',
      'get',
      // Weight/Quantity indicators (treat as product inquiry)
      'kl',
      'kls',
      'kg',
      'kgs',
      'kilos',
      'kilo',
      'pcs',
      'pc',
      'piece',
      'pieces',
      // Filipino/Tagalog
      'magkano',
      'meron',
      'pabili',
      'bili',
      'gusto',
      'kailangan',
      'presyo',
      'available ba',
      'meron ba',
      // Cebuano/Bisaya
      'pila',
      'tagpila',
      'naa ba',
      'palita',
      'gusto ko',
      'kinahanglan',
    ];
    const lowerMessage = messageText.toLowerCase();

    // Check if message contains product-related keywords
    const hasProductKeyword = productKeywords.some((kw) =>
      lowerMessage.includes(kw)
    );

    // Also check if the message mentions any product name directly
    // We need to fetch products first to check this
    this.inventoryService.products$
      .pipe(take(1))
      .subscribe(async (products) => {
        // Check if message mentions any product name
        const messageWords = lowerMessage
          .split(/\s+/)
          .filter((w) => w.length > 2);
        const mentionsProduct = products.some((p) => {
          const productName = p.name.toLowerCase();
          const productWords = productName.split(/\s+/);

          // Check if any product word appears in message
          return (
            productWords.some(
              (word) => word.length > 2 && lowerMessage.includes(word)
            ) || messageWords.some((word) => productName.includes(word))
          );
        });

        // If neither keyword nor product name mentioned, handle as general inquiry
        if (!hasProductKeyword && !mentionsProduct) {
          await this.handleGeneralInquiry(messageText);
          return;
        }

        console.log('AI Auto-responder: Product inquiry detected', {
          hasProductKeyword,
          mentionsProduct,
        });

        if (products.length === 0) {
          console.log('AI Auto-responder: No products in database');
          // Use Gemma as sales rep even when inventory is empty
          const gemmaResponse = await this.aiService.generateWithGemma(
            `You are a helpful store assistant. Customer ${this.senderName} is asking about products but we're restocking. Reply in the same language they used (Filipino, Cebuano, or English). Be brief and friendly: apologize, mention stock arriving soon, ask what they're looking for. 2 sentences max. Use 1 emoji.`
          );
          if (gemmaResponse) {
            await this.chatService.sendMessage(
              gemmaResponse,
              'Support AI',
              this.senderName
            );
          }
          return;
        }

        // Improved product matching - check if message words appear in product name or vice versa
        // Note: messageWords was already defined above
        const matchedProducts = products.filter((p) => {
          const productName = p.name.toLowerCase();
          const productCategory = (p.category || '').toLowerCase();
          const productWords = productName.split(/\s+/);

          // Check if any word from the message appears in product name
          const messageMatchesProduct = messageWords.some(
            (word) =>
              productName.includes(word) || productCategory.includes(word)
          );

          // Check if any word from product name appears in message
          const productMatchesMessage = productWords.some(
            (word) => word.length > 2 && lowerMessage.includes(word)
          );

          return messageMatchesProduct || productMatchesMessage;
        });

        let response = '';

        // Build product context for Gemma
        const productsToShow =
          matchedProducts.length > 0
            ? matchedProducts.slice(0, 5)
            : products.filter((p) => p.quantity > 0).slice(0, 5);

        if (productsToShow.length > 0) {
          // Create product list for Gemma context
          const productList = productsToShow
            .map(
              (p) =>
                `- ${p.name}: ₱${p.price.toFixed(2)} (${
                  p.quantity > 0 ? p.quantity + ' in stock' : 'out of stock'
                })`
            )
            .join('\n');

          const matchType =
            matchedProducts.length > 0 ? 'matching' : 'available';

          // Gemma as senior sales representative - persuasive selling with language matching
          const gemmaPrompt = `You are a friendly store assistant. Customer ${this.senderName} asked: "${messageText}"

Our ${matchType} products:
${productList}

Reply naturally in the same language they used. Be helpful and enthusiastic. Mention the products, prices, and stock. Tell them to click 'Reserve Now' to order. Keep it short (2-3 sentences). Use 1 emoji. Do NOT explain what language you're using or mention language detection.`;

          console.log('AI Auto-responder: Calling Gemma with product context');
          const gemmaResponse = await this.aiService.generateWithGemma(
            gemmaPrompt
          );

          if (gemmaResponse) {
            // Use Gemma's natural response + append reservation link
            const reserveLink = `<br><br><a href="/AI/reservation" class="reserve-btn">🛒 Reserve Now</a>`;
            response = gemmaResponse + reserveLink;
            console.log('AI Auto-responder: Gemma response received');
          } else {
            // Fallback to structured HTML table if Gemma fails
            console.log('AI Auto-responder: Gemma unavailable, using fallback');
            const tableRows = productsToShow.map((p) => {
              const stockStatus =
                p.quantity > 0
                  ? `<span class="stock-available">${p.quantity} in stock</span>`
                  : `<span class="stock-out">Out of stock</span>`;
              return `<tr>
                <td>${p.name}</td>
                <td>₱${p.price.toFixed(2)}</td>
                <td>${stockStatus}</td>
              </tr>`;
            });

            response = `
              <div class="product-inquiry">
                <p><strong>Hello ${this.senderName}!</strong></p>
                <p>Here's what I found:</p>
                <table class="products-table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Price</th>
                      <th>Availability</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${tableRows.join('')}
                  </tbody>
                </table>
                <p class="cta-text">Ready to order? Click below to reserve (your info will be auto-filled!) 🛒</p>
                <a href="/AI/reservation" class="reserve-btn">📦 Reserve Now</a>
              </div>
            `;
          }
        } else {
          // No available products - still sell!
          const gemmaResponse = await this.aiService.generateWithGemma(
            `You are a friendly store assistant. Customer ${this.senderName} wants products but we're out of stock. Their message: "${messageText}"

Reply in the same language they used. Be positive: mention restocking soon, offer to note their preference. 2 sentences max. Use 1 emoji. Do NOT explain what you're doing.`
          );
          response =
            gemmaResponse ||
            `Hello ${this.senderName}! Great timing - we're restocking very soon! 🔥 Let me put you on our VIP list so you get first access. Which items are you interested in?`;
        }

        // Send the AI response
        await this.chatService.sendMessage(
          response,
          'Support AI',
          this.senderName
        );
        console.log('AI Auto-responder: Response sent');
      });
  }

  // Handle general (non-product) inquiries with Gemma
  private async handleGeneralInquiry(messageText: string): Promise<void> {
    // Keywords that should trigger AI response - expanded for better coverage
    const triggerKeywords = [
      // English greetings
      'hello',
      'hi',
      'hey',
      'good morning',
      'good afternoon',
      'good evening',
      'help',
      'question',
      'ask',
      'support',
      'hours',
      'open',
      'location',
      'delivery',
      'shipping',
      'return',
      'refund',
      'payment',
      'contact',
      'thank',
      'thanks',
      'okay',
      'ok',
      'yes',
      'no',
      'what',
      'how',
      'when',
      'where',
      'why',
      // Filipino/Tagalog
      'kumusta',
      'musta',
      'kamusta',
      'opo',
      'po',
      'salamat',
      'maraming salamat',
      'sige',
      'oo',
      'hindi',
      'anong',
      'paano',
      'san',
      'saan',
      'kailan',
      'bakit',
      'pwede',
      // Cebuano/Bisaya
      'maayong',
      'unsay',
      'unsa',
      'asa',
      'kanus-a',
      'ngano',
      'oy',
      'hoy',
      'salamat',
      'daghang salamat',
      'sigi',
      'oo',
      'dili',
      'pwede ba',
    ];
    const lowerMessage = messageText.toLowerCase().trim();

    const shouldRespond = triggerKeywords.some((kw) =>
      lowerMessage.includes(kw)
    );

    // Also respond to very short messages (likely greetings or acknowledgments)
    const isShortMessage =
      lowerMessage.length >= 2 && lowerMessage.length <= 20;

    if (!shouldRespond && !isShortMessage) {
      // Don't respond to every message - let admin handle complex queries
      return;
    }

    console.log('AI Auto-responder: General inquiry detected');

    // Gemma as friendly assistant - natural conversation
    const gemmaPrompt = `You are a friendly store assistant. Customer ${this.senderName} sent: "${messageText}"

Reply naturally in the same language they used. Be warm and helpful. If they're greeting you, greet back and ask what products they're looking for. Keep it short (1-2 sentences). Use 1 emoji. Do NOT mention language or explain what you're doing.`;

    const gemmaResponse = await this.aiService.generateWithGemma(gemmaPrompt);

    if (gemmaResponse) {
      await this.chatService.sendMessage(
        gemmaResponse,
        'Support AI',
        this.senderName
      );
      console.log('AI Auto-responder: General response sent');
    }
  }

  getLocation(silent: boolean = false): void {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const lat = position.coords.latitude;
          const lon = position.coords.longitude;
          this.customerInfo.gpsCoordinates = `${lat.toFixed(6)}, ${lon.toFixed(
            6
          )}`;

          // Auto-fetch address from GPS
          if (!this.customerInfo.address) {
            this.fetchAddressFromGps(lat, lon);
          }
        },
        (error) => {
          console.error('Error getting location', error);
          if (!silent) {
            this.isLocationReadOnly = false; // Allow manual entry
            this.dialogService
              .warning('Unable to retrieve location. Please enter manually.')
              .subscribe();
          }
        }
      );
    } else {
      if (!silent) {
        this.isLocationReadOnly = false;
        this.dialogService
          .warning('Geolocation is not supported by your browser.')
          .subscribe();
      }
    }
  }

  private async fetchAddressFromGps(lat: number, lon: number): Promise<void> {
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}`
      );
      if (response.ok) {
        const data = await response.json();
        if (data.display_name) {
          this.customerInfo.address = data.display_name;
        }
      }
    } catch (e) {
      console.warn('Failed to reverse geocode', e);
    }
  }

  selectConversation(convId: string): void {
    this.currentConversationId = convId;
    this.unreadCounts[convId] = 0; // Clear unread count
    this.updateFilteredMessages(false); // Refreshes view with new filter, no sound
    this.suggestedReplies = []; // Clear old suggestions

    // Admin uses global listener started in checkLoginAndStatus

    // Trigger AI for the last message if meaningful
    if (this.messages.length > 0) {
      const lastMsg = this.messages[this.messages.length - 1];
      // Check if it's a customer message and has text
      if (!this.isMyMessage(lastMsg) && lastMsg.text) {
        this.processIncomingMessage(lastMsg);
      }
    }
  }

  async processIncomingMessage(message: Message) {
    if (!message.text) return;

    // Only show suggested replies for admin users
    if (!this.isAppUser) {
      return;
    }

    // Guard: Ensure we are still looking at the conversation this message belongs to
    if (message.conversationId !== this.currentConversationId) {
      return;
    }

    // Skip heavy AI sentiment analysis to reduce lag
    // Use simple keyword-based suggestions instead

    const customerName = this.getDisplayName(this.currentConversationId || '');
    const lowerMessage = message.text.toLowerCase();

    // Clear old suggestions
    this.suggestedReplies = [];

    // Quick keyword matching without fetching data first
    const isOrderInquiry = [
      'order',
      'delivery',
      'when',
      'status',
      'where',
    ].some((kw) => lowerMessage.includes(kw));
    const isPriceInquiry = ['price', 'how much', 'cost', 'magkano'].some((kw) =>
      lowerMessage.includes(kw)
    );
    const isStockInquiry = ['available', 'stock', 'do you have', 'meron'].some(
      (kw) => lowerMessage.includes(kw)
    );
    const isNegative = [
      'problem',
      'issue',
      'wrong',
      'bad',
      'late',
      'delayed',
      'cancel',
    ].some((kw) => lowerMessage.includes(kw));
    const isPositive = [
      'thank',
      'thanks',
      'great',
      'good',
      'love',
      'perfect',
      'salamat',
    ].some((kw) => lowerMessage.includes(kw));

    // Generate quick suggestions based on keywords
    if (isNegative) {
      this.suggestedReplies = [
        "I'm sorry to hear that. How can we fix this?",
        'Apologies for the inconvenience. Let me check.',
      ];
    } else if (isPositive) {
      this.suggestedReplies = [
        'Thank you! We appreciate it.',
        'Glad to help! Let us know if you need anything else.',
      ];
    } else if (isOrderInquiry) {
      this.suggestedReplies = [
        'Let me check your order status.',
        'Your order is being processed. I will update you shortly.',
      ];
    } else if (isPriceInquiry || isStockInquiry) {
      this.suggestedReplies = [
        'Let me check our inventory for you.',
        'What product are you interested in?',
      ];
    } else {
      this.suggestedReplies = [
        'How can I help you today?',
        'Let me check that for you.',
      ];
    }

    // Add a generic helpful reply
    if (this.suggestedReplies.length < 3) {
      this.suggestedReplies.push('Is there anything else I can help with?');
    }
  }

  async generateFollowUp() {
    if (this.isGeneratingFollowUp) return;

    // Check subscription only for Admin
    if (this.isAppUser && !this.currentUser?.hasSubscription) {
      this.dialogService
        .warning('AI Follow-up requires a subscription.')
        .subscribe();
      return;
    }

    this.isGeneratingFollowUp = true;

    try {
      let customerName = '';
      let targetId = '';

      if (this.isAppUser) {
        if (!this.currentConversationId) {
          this.isGeneratingFollowUp = false;
          return;
        }
        customerName = this.getDisplayName(this.currentConversationId);
        targetId = this.currentConversationId;
      } else {
        // Customer Context
        // Ensure senderName is populated (reload if needed)
        if (!this.senderName) {
          this.senderName = localStorage.getItem('chatUserName') || 'Guest';
        }
        customerName = this.senderName;

        // Check if there is a logged-in App ID (even if !isAppUser logic might be ambiguous, strictly speaking 'jjm_user_id' is the auth token)
        // If the user considers themselves a "Customer" but is logged in with an ID:
        const appUserId = localStorage.getItem('customer_id');
        targetId = appUserId ? appUserId : this.senderName;
      }

      console.log(
        'Generating AI Follow-up for:',
        customerName,
        '(ID:',
        targetId,
        ')'
      );

      // 2. Get Sales History
      this.inventoryService.sales$.pipe(take(1)).subscribe(async (sales) => {
        let promptContent = '';

        // Filter for this customer
        const customerSales = sales.filter((s) => {
          // Normalize for comparison
          const cId = (s.customerId || '').trim().toLowerCase();
          const uId = (s.userId || '').trim().toLowerCase();
          const sCustomerName = (s.customerName || '').trim().toLowerCase(); // For reservations
          const tId = targetId.trim().toLowerCase();
          const cName = customerName.trim().toLowerCase();
          const storedCustomerId = (localStorage.getItem('customer_id') || '')
            .trim()
            .toLowerCase();

          // Check match:
          // 1. Sale CustomerID matches TargetID
          // 2. Sale UserID matches TargetID
          // 3. Sale CustomerID matches Name
          // 4. Sale CustomerID matches stored customer_id
          // 5. Sale CustomerName matches customer name (for reservations)
          return (
            cId === tId ||
            uId === tId ||
            cId === cName ||
            (storedCustomerId && cId === storedCustomerId) ||
            sCustomerName === cName // NEW: Match by customerName field
          );
        });

        console.log(
          'Sales filter - Total sales:',
          sales.length,
          'Matched:',
          customerSales.length
        );

        if (this.isAppUser) {
          // --- ADMIN VIEW ---
          customerSales.sort(
            (a, b) =>
              new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
          );
          let lastSaleDetails = 'has no recent purchases';
          if (customerSales.length > 0) {
            const lastSale = customerSales[0];
            lastSaleDetails = `bought ${lastSale.productName} on ${new Date(
              lastSale.timestamp
            ).toLocaleDateString()}`;
          }
          const prompt = `Customer ${customerName} ${lastSaleDetails}. Write a short polite follow-up message from the shop asking if they are satisfied:`;
          const generated = await this.aiService.generateText(prompt);
          if (generated) {
            this.newMessage = generated;
          }
        } else {
          // --- CUSTOMER VIEW ---
          console.log('--- Customer Follow-up Debug ---');
          console.log('Total sales from service:', sales.length);
          console.log('CustomerName:', customerName, '| TargetID:', targetId);

          // 1. Sort by date (newest first)
          customerSales.sort(
            (a, b) =>
              new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
          );

          console.log('Matched Sales for customer:', customerSales.length);

          // 2. Prioritize Pending
          let pendingSales = customerSales.filter((s) => s.pending === true);
          console.log('Pending Sales:', pendingSales.length);

          if (pendingSales.length === 0 && customerSales.length > 0) {
            console.log('No explicitly pending sales. Using latest sale.');
            pendingSales = [customerSales[0]]; // Use only the latest
          }

          let prompt = '';
          let generated: string | null = null;

          if (pendingSales.length > 0) {
            const safeName = customerName || 'Valued Customer';

            // Build an HTML table for ALL orders
            const tableRows = pendingSales.map((s, index) => {
              const dateStr = s.deliveryDate
                ? new Date(s.deliveryDate).toLocaleDateString()
                : 'Soon';
              const safeProduct = s.productName || 'Items';
              const safeQty = s.quantitySold || 1;
              const totalPrice = (s?.price || 0) * safeQty;

              return `<tr>
                <td>${index + 1}</td>
                <td>${safeProduct}</td>
                <td>${safeQty > 1 ? safeQty + ' pcs' : safeQty + ' pc'}</td>
                <td>${dateStr}</td>
                <td>₱${totalPrice.toFixed(2)}</td>
              </tr>`;
            });

            console.log('Using sales:', pendingSales.length, 'orders');

            // Build the complete HTML message with table
            const convo = `
              <div class="order-summary">
                <p><strong>Hello ${safeName}!</strong></p>
                <p>Here are your orders:</p>
                <table class="orders-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Product</th>
                      <th>Qty</th>
                      <th>Delivery</th>
                      <th>Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${tableRows.join('')}
                  </tbody>
                </table>
                <p class="thank-you">Thank you for your patience! 🙏</p>
              </div>
            `;
            generated = convo;
          } else {
            generated = `Hello ${
              customerName || 'Customer'
            }, I checked our system and you currently have no pending deliveries. Feel free to reach out if you have any questions!`;
          }

          console.log('AI Response (using template):', generated);

          if (generated) {
            // Send as "Support AI" message, but use senderName as conversationId
            // so it appears in the customer's own chat thread.
            await this.chatService.sendMessage(
              generated,
              'Support AI',
              this.senderName // Use display name for conversation matching
            );
            console.log('Message sent to chat.');
          }
        }

        this.isGeneratingFollowUp = false;
      });
    } catch (e) {
      console.error('Follow-up generation failed', e);
      this.isGeneratingFollowUp = false;
    }
  }

  useSmartReply(reply: string) {
    this.newMessage = reply;
    // Optional: Auto-send or let user edit?
    // Let's just fill it in so they can edit/send.
    // If you want auto-send, call this.sendMessage() here.
  }

  private scrollToBottom(): void {
    if (!this.messagesContainer) return;
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
    // Check by User ID first (most reliable for App Users)
    const storedId = localStorage.getItem('jjm_user_id');
    if (this.isAppUser && storedId && message.userId === storedId) {
      return true;
    }

    // Check by Sender Name
    return message.senderName === this.senderName;
  }

  canDeleteMessage(message: Message): boolean {
    // User can delete their own messages
    if (this.isMyMessage(message)) {
      return true;
    }

    // Admin (product owner) can delete Support AI messages
    if (this.isAppUser && message.senderName === 'Support AI') {
      return true;
    }

    return false;
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
          this.dialogService
            .error('Could not access microphone. Please allow permissions.')
            .subscribe();
          this.isRecording = false;
        });
    } else {
      this.dialogService
        .error('Audio recording is not supported in this browser.')
        .subscribe();
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
      this.dialogService.warning('Please select a conversation first.');
      return;
    }

    this.chatService
      .sendAudioMessage(base64, this.senderName, convId)
      .subscribe({
        next: () => {
          this.shouldScroll = true;
        },
        error: (error) => {
          console.error('Error sending audio message:', error);
          this.dialogService.error('Failed to send audio message.').subscribe();
        },
      });
  }

  deleteMessage(message: Message): void {
    if (!this.canDeleteMessage(message)) return;

    this.dialogService
      .confirm(
        'Are you sure you want to delete this message?',
        'Delete Message'
      )
      .subscribe((confirmed) => {
        if (confirmed) {
          this.chatService.deleteMessage(message.id).subscribe({
            error: (error) => {
              console.error('Error deleting message:', error);
              this.dialogService.error('Failed to delete message.').subscribe();
            },
          });
        }
      });
  }

  logout(): void {
    if (this.isAppUser) {
      this.dialogService
        .warning('You cannot logout of chat while logged into the application.')
        .subscribe();
      return;
    }

    this.dialogService
      .confirm(
        'Are you sure you want to logout? Your information will be cleared.',
        'Logout'
      )
      .subscribe((confirmed) => {
        if (confirmed) {
          // localStorage.removeItem('chatCustomerInfo');
          // localStorage.removeItem('chatUserName');
          this.isRegistered = false;
          this.customerInfo = {
            name: '',
            phoneNumber: '',
            address: '',
          };
          this.messages = [];
        }
      });
  }

  // --- Call Logic ---
  startCall(): void {
    const targetId = this.isAppUser
      ? this.currentConversationId
      : this.senderName;

    if (!targetId) {
      this.dialogService
        .error('Cannot start call: Unknown conversation.')
        .subscribe();
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
      this.stopRinging();
    }
  }

  endCall(): void {
    this.callService.endCall();
    this.isSpeakerOn = false;
    this.isMicMuted = false;
    this.cleanupAudioVisualizer();
  }

  setupAudioVisualizer(stream: MediaStream): void {
    this.cleanupAudioVisualizer(); // Safety cleanup
    try {
      const AudioContext =
        window.AudioContext || (window as any).webkitAudioContext;
      this.audioContext = new AudioContext();
      // Resume if suspended (common in Chrome/Edge)
      if (this.audioContext.state === 'suspended') {
        console.log(
          'ChatComponent: AudioContext suspended. Attempting to resume...'
        );
        this.audioContext
          .resume()
          .then(() => console.log('ChatComponent: AudioContext resumed!'));
      }

      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 64; // Low res is fine for volume
      this.source = this.audioContext.createMediaStreamSource(stream);
      this.source.connect(this.analyser);
      this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);

      const updateVolume = () => {
        if (!this.analyser || !this.dataArray) return;
        // @ts-ignore
        this.analyser.getByteFrequencyData(this.dataArray);

        // Log occasional non-zero for debug
        // if (this.dataArray[0] > 0) console.log('Audio Data:', this.dataArray[0]);

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
