import {
  Component,
  OnInit,
  ViewChild,
  ElementRef,
  AfterViewChecked,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ChatService } from '../../services/chat.service';
import { Message, Customer } from '../../models/inventory.models';

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
export class ChatComponent implements OnInit, AfterViewChecked {
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

  constructor(private chatService: ChatService) {}

  ngOnInit(): void {
    // Check if customer info exists in localStorage
    const savedCustomerInfo = localStorage.getItem('chatCustomerInfo');
    if (savedCustomerInfo) {
      this.customerInfo = JSON.parse(savedCustomerInfo);
      this.senderName = this.customerInfo.name;
      this.isRegistered = true;
      this.loadMessages();
    }
  }

  ngAfterViewChecked(): void {
    if (this.shouldScroll) {
      this.scrollToBottom();
      this.shouldScroll = false;
    }
  }

  registerCustomer(): void {
    // Validate all fields
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

    // Validate phone number format (simple validation)
    const phoneRegex = /^[\d\s\-\+\(\)]+$/;
    if (!phoneRegex.test(this.customerInfo.phoneNumber)) {
      alert('Please enter a valid phone number');
      return;
    }

    // Save customer info
    localStorage.setItem('chatCustomerInfo', JSON.stringify(this.customerInfo));
    localStorage.setItem('chatUserName', this.customerInfo.name);
    this.senderName = this.customerInfo.name;
    this.isRegistered = true;

    // Load messages after registration
    this.loadMessages();
  }

  private loadMessages(): void {
    // Subscribe to messages
    this.chatService.getMessages().subscribe({
      next: (messages) => {
        const hadMessages = this.messages.length > 0;
        this.messages = messages;

        // Auto-scroll on new messages
        if (!hadMessages || this.messages.length > messages.length) {
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

    this.chatService
      .sendMessage(this.newMessage, this.senderName)
      .then(() => {
        this.newMessage = '';
        this.shouldScroll = true;
      })
      .catch((error) => {
        console.error('Error sending message:', error);
        alert('Failed to send message. Please try again.');
      });
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
    confirm('Do you want to update your customer information?');
    this.isRegistered = false;
  }

  logout(): void {
    confirm(
      'Are you sure you want to logout? Your information will be cleared.'
    );
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
