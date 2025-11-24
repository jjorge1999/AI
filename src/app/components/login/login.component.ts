import { Component, OnInit, OnDestroy, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css'
})
export class LoginComponent implements OnInit, OnDestroy {
  username = '';
  password = '';
  errorMessage = '';
  isLoading = false;
  bubbles: Array<{x: number, y: number, size: number, delay: number}> = [];

  ngOnInit(): void {
    this.generateBubbles();
  }

  ngOnDestroy(): void {
    // Cleanup if needed
  }

  @HostListener('mousemove', ['$event'])
  onMouseMove(event: MouseEvent): void {
    const bubbleElements = document.querySelectorAll('.bubble');
    bubbleElements.forEach((bubble: Element) => {
      const htmlBubble = bubble as HTMLElement;
      const rect = htmlBubble.getBoundingClientRect();
      const bubbleCenterX = rect.left + rect.width / 2;
      const bubbleCenterY = rect.top + rect.height / 2;
      
      const deltaX = event.clientX - bubbleCenterX;
      const deltaY = event.clientY - bubbleCenterY;
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      
      if (distance < 250) {
        const force = (250 - distance) / 250;
        const moveX = (deltaX / distance) * force * 50;
        const moveY = (deltaY / distance) * force * 50;
        htmlBubble.style.transform = `translate(${moveX}px, ${moveY}px) scale(${1 + force * 0.3})`;
      } else {
        htmlBubble.style.transform = 'translate(0, 0) scale(1)';
      }
    });
  }

  generateBubbles(): void {
    for (let i = 0; i < 15; i++) {
      this.bubbles.push({
        x: Math.random() * 100,
        y: Math.random() * 100,
        size: Math.random() * 100 + 50,
        delay: Math.random() * 5
      });
    }
  }

  onLogin(): void {
    this.errorMessage = '';
    
    if (!this.username || !this.password) {
      this.errorMessage = 'Please enter both username and password';
      return;
    }

    this.isLoading = true;

    // Simple authentication (for demo - in production use proper auth service)
    setTimeout(() => {
      if (this.username === 'jjm143256789' && this.password === 'Gr*l0v3R') {
        localStorage.setItem('jjm_logged_in', 'true');
        localStorage.setItem('jjm_username', this.username);
        window.location.reload();
      } else {
        this.errorMessage = 'Invalid username or password';
        this.isLoading = false;
      }
    }, 800);
  }
}
