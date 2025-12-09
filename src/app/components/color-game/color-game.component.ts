import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { CustomerService } from '../../services/customer.service';
import { Customer } from '../../models/inventory.models';

type Color = 'red' | 'green' | 'blue' | 'yellow' | 'white' | 'pink';

@Component({
  selector: 'app-color-game',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './color-game.component.html',
  styleUrls: ['./color-game.component.css'],
})
export class ColorGameComponent implements OnInit {
  credits: number = 0;
  bets: { [key in Color]: number } = {
    red: 0,
    green: 0,
    blue: 0,
    yellow: 0,
    white: 0,
    pink: 0,
  };

  colors: Color[] = ['red', 'green', 'blue', 'yellow', 'white', 'pink'];
  result: Color[] = ['white', 'white', 'white'];
  isRolling = false;
  message = '';
  dailyBonusMessage = '';

  // Verification
  isVerified = false;
  verificationName = '';
  verificationPhone = '';
  verificationError = '';
  isLoadingCustomers = false;
  currentCustomerId = '';
  currentCustomer: Customer | null = null;
  // private allCustomers: Customer[] = []; // Removed for security

  /* Dynamic Keys based on User */
  private get storageKeyCredits(): string {
    return `color_game_credits_${this.sanitizedName}`;
  }

  private get storageKeyLastDaily(): string {
    return `color_game_last_daily_${this.sanitizedName}`;
  }

  private get sanitizedName(): string {
    // Sanitizes name to be safe for local storage key (e.g. "John Doe" -> "john_doe")
    return (this.verificationName || 'guest')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_');
  }

  constructor(
    private router: Router,
    private customerService: CustomerService
  ) {}

  goBack() {
    this.router.navigate(['/login']);
  }

  ngOnInit(): void {
    // Only check auto-verif, do not load all customers
    this.checkAutoVerification();
  }

  checkAutoVerification() {
    const savedInfo = localStorage.getItem('chatCustomerInfo');
    if (savedInfo) {
      try {
        const info = JSON.parse(savedInfo);
        if (info && info.name) {
          this.verificationName = info.name;
          this.verifyCustomer();
        }
      } catch (e) {
        console.error('Error parsing auto-verification info', e);
      }
    }
  }

  verifyCustomer() {
    if (!this.verificationName.trim()) {
      this.verificationError = 'Please enter your name.';
      return;
    }
    if (!this.verificationPhone.trim()) {
      this.verificationError = 'Please enter your phone number.';
      return;
    }

    this.isLoadingCustomers = true;
    this.verificationError = '';
    const nameToVerify = this.verificationName.trim();

    // Verify specifically by name on server to avoid exposing full DB
    this.customerService.getCustomerByName(nameToVerify).subscribe({
      next: (customers) => {
        this.isLoadingCustomers = false;
        // Strict case-insensitive match on returned results
        const found = customers.find(
          (c) => c.name.toLowerCase() === nameToVerify.toLowerCase()
        );

        if (found) {
          // Verify Phone Number (Last 8 Digits)
          const inputLast8 = this.verificationPhone
            .replace(/\D/g, '')
            .slice(-8);
          // Backend now returns last 8 digits or full phone. We sanitize just in case.
          const targetLast8 = (found.phoneNumber || '')
            .replace(/\D/g, '')
            .slice(-8);

          if (inputLast8 !== targetLast8) {
            this.isVerified = false;
            this.verificationError =
              'Verification failed: Phone number mismatch.';
            return;
          }

          this.isVerified = true;
          this.currentCustomerId = found.id;
          this.currentCustomer = found;
          this.verificationError = '';

          this.loadGameData();
          // this.checkDailyBonus(); // Removed: One-time bonus only
        } else {
          this.isVerified = false;
          this.verificationError =
            'Access Denied: Customer not found. Please check your spelling.';
        }
      },
      error: (err) => {
        console.error('Verification failed', err);
        this.isLoadingCustomers = false;
        this.verificationError = 'Verification service unavailable.';
      },
    });
  }

  loadGameData() {
    if (!this.isVerified) return;

    // Priority: Database
    if (
      this.currentCustomer &&
      this.currentCustomer.credits !== undefined &&
      this.currentCustomer.credits !== null
    ) {
      // Existing User: Load from DB
      this.credits = this.currentCustomer.credits;
      localStorage.setItem(this.storageKeyCredits, this.credits.toString());
    } else {
      // New User (No credits in DB): Give One-Time Welcome Bonus
      console.log('New player detected, giving 100 welcome credits');
      this.credits = 100;
      this.message = 'Welcome! You received 100 Free Credits!';
      this.saveGameData(); // Initialize in DB
    }
  }

  saveGameData() {
    if (!this.isVerified) return;

    // 1. Save to Local Storage (Immediate UI consistency)
    localStorage.setItem(this.storageKeyCredits, this.credits.toString());

    // 2. Save to Database (Background sync)
    if (this.currentCustomerId) {
      this.customerService
        .updateCustomer(this.currentCustomerId, {
          credits: this.credits,
        })
        .subscribe({
          error: (err) =>
            console.error('Failed to sync credits to database:', err),
        });
    }
  }

  checkDailyBonus() {
    // Only give bonus if verified
    if (!this.isVerified) return;

    const lastDate = localStorage.getItem(this.storageKeyLastDaily);
    const today = new Date().toDateString();

    if (lastDate !== today) {
      this.credits += 100;
      localStorage.setItem(this.storageKeyLastDaily, today);
      this.saveGameData();
      this.dailyBonusMessage = '🎉 You received 100 Daily Free Credits!';
      setTimeout(() => (this.dailyBonusMessage = ''), 5000);
    }
  }

  placeBet(color: Color, amount: number) {
    if (this.isRolling) return;
    if (this.credits >= amount) {
      this.credits -= amount;
      this.bets[color] += amount;
      this.saveGameData();
    } else {
      this.message = 'Not enough credits!';
      setTimeout(() => (this.message = ''), 2000);
    }
  }

  clearBets() {
    if (this.isRolling) return;
    let totalRefund = 0;
    this.colors.forEach((c) => {
      totalRefund += this.bets[c];
      this.bets[c] = 0;
    });
    this.credits += totalRefund;
    this.saveGameData();
  }

  get totalBet(): number {
    return Object.values(this.bets).reduce((a, b) => a + b, 0);
  }

  rollDice() {
    if (this.totalBet === 0) {
      this.message = 'Place a bet first!';
      setTimeout(() => (this.message = ''), 2000);
      return;
    }
    if (this.isRolling) return;

    this.isRolling = true;
    this.message = '';

    // Animation simulation
    let rolls = 0;
    const maxRolls = 20;
    const interval = setInterval(() => {
      this.result = [
        this.getRandomColor(),
        this.getRandomColor(),
        this.getRandomColor(),
      ];
      rolls++;
      if (rolls >= maxRolls) {
        clearInterval(interval);
        this.finalizeRoll();
      }
    }, 100);
  }

  getRandomColor(): Color {
    // specific implementation to avoid patterns using crypto
    const array = new Uint32Array(1);
    window.crypto.getRandomValues(array);
    // Use modulo for mapping (bias is negligible with Uint32 for 6 items)
    const idx = array[0] % this.colors.length;
    return this.colors[idx];
  }

  finalizeRoll() {
    this.isRolling = false;

    // Calculate Winnings
    let totalWinnings = 0;
    const matches: { [key in Color]: number } = {
      red: 0,
      green: 0,
      blue: 0,
      yellow: 0,
      white: 0,
      pink: 0,
    };

    // Count matches
    this.result.forEach((r) => matches[r]++);

    // Check bets against matches
    this.colors.forEach((color) => {
      const betAmount = this.bets[color];
      const matchCount = matches[color];

      if (betAmount > 0 && matchCount > 0) {
        // Payout: Bet * MatchCount + Bet (Return Stake)
        // Standard Color Game rules
        const winnings = betAmount * matchCount + betAmount;
        totalWinnings += winnings;
      }
    });

    if (totalWinnings > 0) {
      this.credits += totalWinnings;
      this.message = `You won ${totalWinnings} credits! 🎉`;
    } else {
      this.message = 'Better luck next time!';
    }

    // Reset bets
    this.colors.forEach((c) => (this.bets[c] = 0));
    this.saveGameData();
  }

  getColorHex(color: string): string {
    const map: { [key: string]: string } = {
      red: '#ef4444',
      green: '#22c55e',
      blue: '#3b82f6',
      yellow: '#eab308',
      white: '#ffffff',
      pink: '#ec4899',
    };
    return map[color];
  }
}
