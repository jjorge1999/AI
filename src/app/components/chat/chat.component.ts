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
import { Message } from '../../models/inventory.models';

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

  constructor(private chatService: ChatService) {}

  ngOnInit(): void {
    // Get sender name from localStorage or prompt
    this.senderName = localStorage.getItem('chatUserName') || '';
    this.senderName = localStorage.getItem('chatUserName') || '';
    if (!this.senderName) {
      this.senderName = 'User ' + Math.floor(Math.random() * 1000);
      localStorage.setItem('chatUserName', this.senderName);
    }

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

  ngAfterViewChecked(): void {
    if (this.shouldScroll) {
      this.scrollToBottom();
      this.shouldScroll = false;
    }
  }

  sendMessage(): void {
    if (!this.newMessage.trim()) return;

    this.chatService.sendMessage(this.newMessage, this.senderName).subscribe({
      next: () => {
        this.newMessage = '';
        this.shouldScroll = true;
      },
      error: (error) => {
        console.error('Error sending message:', error);
        alert('Failed to send message. Please try again.');
      },
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

  changeName(): void {
    const newName = prompt('Enter your new name:', this.senderName);
    if (newName && newName.trim()) {
      this.senderName = newName.trim();
      localStorage.setItem('chatUserName', this.senderName);
    }
  }
}
