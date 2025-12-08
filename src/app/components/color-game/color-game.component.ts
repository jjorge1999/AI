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
  verificationError = '';
  isLoadingCustomers = false;
  currentCustomerId = '';
  private allCustomers: Customer[] = [];

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
    // Note: Removed loadGameData() from here. We only load data AFTER verification of user.

    // Load customers first for verification
    this.isLoadingCustomers = true;
    this.customerService.getCustomers().subscribe({
      next: (customers) => {
        this.allCustomers = customers;
        this.isLoadingCustomers = false;
        this.checkAutoVerification();
      },
      error: (err) => {
        console.error('Failed to load customers', err);
        this.isLoadingCustomers = false;
        this.verificationError = 'Unable to connect to customer database.';
      },
    });
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

    const found = this.allCustomers.find(
      (c) => c.name.toLowerCase() === this.verificationName.trim().toLowerCase()
    );

    if (found) {
      this.isVerified = true;
      this.currentCustomerId = found.id;
      this.verificationError = '';

      // Load THIS specific user's data
      this.loadGameData();
      this.checkDailyBonus();
    } else {
      this.isVerified = false;
      this.verificationError =
        'Access Denied: You must be a registered customer.';
    }
  }

  loadGameData() {
    if (!this.isVerified) return;

    // Priority: Database > LocalStorage
    // We check the 'found' customer object from memory which was just loaded from DB
    const customer = this.allCustomers.find(
      (c) => c.id === this.currentCustomerId
    );

    if (
      customer &&
      customer.credits !== undefined &&
      customer.credits !== null
    ) {
      this.credits = customer.credits;
      // Sync local storage to match DB
      localStorage.setItem(this.storageKeyCredits, this.credits.toString());
    } else {
      // Fallback to local storage (e.g. first time syncing or field missing)
      const savedCredits = localStorage.getItem(this.storageKeyCredits);
      this.credits = savedCredits ? parseInt(savedCredits, 10) : 0;
    }
  }

  saveGameData() {
    if (!this.isVerified) return;

    // 1. Save to Local Storage (Immediate UI consistency)
    localStorage.setItem(this.storageKeyCredits, this.credits.toString());

    // 2. Save to Database (Background sync)
    if (this.currentCustomerId) {
      this.customerService.updateCustomer(this.currentCustomerId, {
        credits: this.credits,
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
