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
import { Message, Customer } from '../../models/inventory.models';
import { Subscription } from 'rxjs';

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
    private customerService: CustomerService
  ) {}

  ngOnInit(): void {
    // Load customers list first for validation
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

    if (isAppLoggedIn) {
      this.isAppUser = true;
    }

    // 1. Try Auto-login with App Credentials
    if (isAppLoggedIn && appUsername) {
      this.senderName = appUsername;
      this.isRegistered = true;
      this.errorMessage = '';

      const foundCustomer = this.allCustomers.find(
        (c) => c.name.toLowerCase() === appUsername.toLowerCase()
      );

      if (foundCustomer) {
        this.customerInfo = {
          name: foundCustomer.name,
          phoneNumber: foundCustomer.phoneNumber,
          address: foundCustomer.deliveryAddress,
        };
      } else {
        // Logged in but not in customer DB - allow chat anyway with basic info
        this.customerInfo = {
          name: appUsername,
          phoneNumber: 'N/A',
          address: 'N/A',
        };
      }

      this.loadMessages();
      return;
    }

    // 2. Fallback: Check localStorage for previous chat session
    const savedCustomerInfo = localStorage.getItem('chatCustomerInfo');
    if (savedCustomerInfo) {
      const parsedInfo = JSON.parse(savedCustomerInfo);

      // Verify this saved user still exists in DB
      const foundCustomer = this.allCustomers.find(
        (c) => c.name.toLowerCase() === parsedInfo.name.toLowerCase()
      );

      if (foundCustomer) {
        this.customerInfo = parsedInfo;
        this.senderName = this.customerInfo.name;
        this.isRegistered = true;
        this.loadMessages();
      } else {
        // Saved user no longer exists/valid
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

    // Optional: Verify phone match too?
    // For now just name as per "if user is found" request foundation

    // Save info and proceed
    localStorage.setItem('chatCustomerInfo', JSON.stringify(this.customerInfo));
    localStorage.setItem('chatUserName', this.customerInfo.name);
    this.senderName = this.customerInfo.name;
    this.isRegistered = true;

    this.loadMessages();
  }

  private loadMessages(): void {
    // Subscribe to messages
    this.chatService.getMessages().subscribe({
      next: (allMessages) => {
        // Admin Logic: Find all unique conversation IDs
        if (this.isAppUser) {
          const convSet = new Set<string>();
          allMessages.forEach((msg) => {
            if (msg.conversationId) convSet.add(msg.conversationId);
          });
          this.conversations = Array.from(convSet);
          // If no conversation selected, maybe select first? Or allow none.
        }

        // Filter messages for current conversation
        // If Customer: conversationId is their name
        // If Admin: conversationId is the selected one
        const targetId = this.isAppUser
          ? this.currentConversationId
          : this.senderName;

        const filteredMessages = allMessages.filter((msg) => {
          return msg.conversationId === targetId;
        });

        const hadMessages = this.messages.length > 0;
        this.messages = filteredMessages;

        // Auto-scroll on new messages
        if (!hadMessages || this.messages.length > filteredMessages.length) {
          this.shouldScroll = true;
        }
      },
      error: (error) => {
        console.error('Error loading messages:', error);
      },
    });
  }

  sendMessage(): void {
    if (!this.newMessage.trim()) return;

    // Determine Conversation ID
    // If Customer: their name
    // If Admin: current selected conversation
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
    this.loadMessages(); // Refreshes view with new filter
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
