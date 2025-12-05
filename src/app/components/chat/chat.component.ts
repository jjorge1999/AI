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
import { Message, Customer } from '../../models/inventory.models';
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

  constructor(
    private chatService: ChatService,
    private customerService: CustomerService,
    private userService: UserService
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

    this.loadMessages();
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
}
