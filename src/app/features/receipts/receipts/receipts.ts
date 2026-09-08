import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  AttendanceRecord,
  Employee,
  Payment
} from '../../../services/attendance.service';

@Component({
  selector: 'app-receipts',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './receipts.html',
  styleUrl: './receipts.scss'
})
export class ReceiptsComponent {

  @Input() employees: Employee[] = [];
  @Input() records: AttendanceRecord[] = [];
  @Input() allPayments: Payment[] = [];

  @Output() refreshRequested = new EventEmitter<void>();

  // Angular templates do not expose the global Math object automatically.
  readonly Math = Math;

  // ---------------------------------------------------------
  // STATE
  // ---------------------------------------------------------

  readonly receiptEmployeeId = signal<number | null>(null);

  readonly receiptPayment = signal<Payment | null>(null);

  readonly receiptEmployee = signal<Employee | null>(null);

  readonly receiptYear = signal(new Date().getFullYear());

  readonly receiptMonth = signal(new Date().getMonth() + 1);

  readonly receiptStartDate = signal(this.today());

  readonly receiptEndDate = signal(this.today());

  readonly busy = signal(false);

  readonly error = signal('');

  readonly message = signal('');

  // UPI mobile-number payment flow. The employee's phone number is
  // used as the recipient identifier; no fake mobile@upi VPA is created.
  readonly showUpiPayment = signal(false);
  readonly upiAmount = signal(0);
  readonly upiMobile = signal('');
  readonly upiStatus = signal('');

  // ---------------------------------------------------------
  // MONTHS
  // ---------------------------------------------------------

  readonly receiptMonths = Array.from(
    { length: 12 },
    (_, index) => ({
      value: index + 1,
      label: new Date(
        2000,
        index,
        1
      ).toLocaleDateString(
        'en-IN',
        {
          month: 'long'
        }
      )
    })
  );

  // ---------------------------------------------------------
  // YEARS
  // ---------------------------------------------------------

  receiptYears(): number[] {
    const years = new Set<number>();

    years.add(new Date().getFullYear());

    this.records.forEach(record => {
      const year = Number(
        record.attendance_date?.slice(0, 4)
      );

      if (year) {
        years.add(year);
      }
    });

    this.allPayments.forEach(payment => {
      const year = Number(
        payment.payment_date?.slice(0, 4)
      );

      if (year) {
        years.add(year);
      }
    });

    return Array.from(years).sort(
      (a, b) => b - a
    );
  }

  // ---------------------------------------------------------
  // RECEIPT PERIOD
  // ---------------------------------------------------------

  receiptMonthStart(): string {
    return (
      `${this.receiptYear()}-` +
      `${String(this.receiptMonth()).padStart(2, '0')}-01`
    );
  }

  receiptMonthEnd(): string {
    const lastDay = new Date(
      this.receiptYear(),
      this.receiptMonth(),
      0
    ).getDate();

    return (
      `${this.receiptYear()}-` +
      `${String(this.receiptMonth()).padStart(2, '0')}-` +
      `${String(lastDay).padStart(2, '0')}`
    );
  }

  // ---------------------------------------------------------
  // RECEIPT LIST
  // ---------------------------------------------------------

  receiptPayments(): Payment[] {
    const employeeId =
      this.receiptEmployeeId();

    const start =
      this.receiptMonthStart();

    const end =
      this.receiptMonthEnd();

    return this.allPayments
      .filter(payment =>
        payment.status === 'completed' &&
        payment.payment_date >= start &&
        payment.payment_date <= end &&
        (
          employeeId === null ||
          payment.employee_id === employeeId
        )
      )
      .sort(
        (a, b) =>
          b.payment_date.localeCompare(
            a.payment_date
          ) ||
          b.id - a.id
      );
  }

  /**
   * All completed payments for the currently
   * selected employee and selected period.
   */
  receiptMonthPayments(): Payment[] {
    const employee =
      this.receiptEmployee();

    if (!employee) {
      return [];
    }

    return this.allPayments
      .filter(payment =>
        payment.employee_id === employee.id &&
        payment.status === 'completed' &&
        payment.payment_date >=
          this.receiptStartDate() &&
        payment.payment_date <=
          this.receiptEndDate()
      )
      .sort(
        (a, b) =>
          a.payment_date.localeCompare(
            b.payment_date
          ) ||
          a.id - b.id
      );
  }

  // ---------------------------------------------------------
  // FILTER / PERIOD SELECTION
  // ---------------------------------------------------------

  selectReceiptMonth(): void {
    const start =
      this.receiptMonthStart();

    const end =
      this.receiptMonthEnd();

    const employeeId =
      this.receiptEmployeeId();

    const employee =
      employeeId === null
        ? null
        : this.employeeForPayment(
            employeeId
          ) ?? null;

    /*
     * Changing filters should only change
     * the receipt list.
     *
     * It must NOT automatically open
     * a receipt.
     */
    this.receiptPayment.set(null);

    this.receiptEmployee.set(employee);

    this.receiptStartDate.set(start);

    this.receiptEndDate.set(end);

    this.error.set('');
  }

  /**
   * Compatibility method used by the current
   * receipts.html template.
   */
  selectPeriod(): void {
    this.selectReceiptMonth();
  }

  // ---------------------------------------------------------
  // OPEN RECEIPT
  // ---------------------------------------------------------

  openReceipt(payment: Payment): void {

    if (payment.status !== 'completed') {
      this.error.set(
        'Only completed payments can have receipts.'
      );
      return;
    }

    const employee =
      this.employeeForPayment(
        payment.employee_id
      );

    if (!employee) {
      this.error.set(
        'Employee profile not found.'
      );
      return;
    }

    const paymentDate = new Date(
      `${payment.payment_date}T00:00:00`
    );

    const year =
      paymentDate.getFullYear();

    const month =
      paymentDate.getMonth() + 1;

    this.receiptYear.set(year);

    this.receiptMonth.set(month);

    this.receiptPayment.set(payment);

    this.receiptEmployee.set(employee);

    this.receiptStartDate.set(
      `${year}-${String(month).padStart(2, '0')}-01`
    );

    const lastDay = new Date(
      year,
      month,
      0
    ).getDate();

    this.receiptEndDate.set(
      `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
    );

    this.error.set('');
  }

  receiptRows(): Array<{
  employee: Employee;
  total: number;
  count: number;
  latestPayment: Payment;
}> {
  const groups = new Map<number, Payment[]>();

  for (const payment of this.receiptPayments()) {
    const existing =
      groups.get(payment.employee_id) ?? [];

    existing.push(payment);

    groups.set(
      payment.employee_id,
      existing
    );
  }

  return Array.from(groups.entries())
    .map(([employeeId, payments]) => {

      const employee =
        this.employeeForPayment(employeeId);

      if (!employee || payments.length === 0) {
        return null;
      }

      const sortedPayments =
        [...payments].sort(
          (a, b) =>
            b.payment_date.localeCompare(
              a.payment_date
            ) ||
            b.id - a.id
        );

      return {
        employee,
        total: payments.reduce(
          (sum, payment) =>
            sum +
            Number(payment.amount || 0),
          0
        ),
        count: payments.length,
        latestPayment: sortedPayments[0]
      };
    })
    .filter(
      (
        row
      ): row is {
        employee: Employee;
        total: number;
        count: number;
        latestPayment: Payment;
      } =>
        row !== null
    );
}

  viewReceipt(payment: Payment): void {
    this.openReceipt(payment);
  }

  /**
   * Used by the receipts template.
   */
  showReceipt(): boolean {
    return this.receiptPayment() !== null;
  }

  /**
   * Used by the receipts template.
   */
  closeReceipt(): void {
    this.receiptPayment.set(null);

    this.receiptEmployee.set(null);

    this.error.set('');
  }

  // ---------------------------------------------------------
  // EMPLOYEE HELPERS
  // ---------------------------------------------------------

  employeeForPayment(
    employeeId: number
  ): Employee | undefined {
    return this.employees.find(
      employee =>
        employee.id === employeeId
    );
  }

  /**
   * Used by the receipts template.
   */
  selectedEmployee(): Employee | null {
    return this.receiptEmployee();
  }

  // ---------------------------------------------------------
  // RECEIPT CALCULATIONS
  // ---------------------------------------------------------

  receiptNumber(): string {
    const payment =
      this.receiptPayment();

    if (payment) {
      return (
        `SH-PAY-` +
        `${String(payment.id).padStart(6, '0')}`
      );
    }

    return (
      `SH-` +
      `${this.receiptYear()}` +
      `${String(this.receiptMonth()).padStart(2, '0')}`
    );
  }

  receiptWorkDays(): number {
    const employee =
      this.receiptEmployee();

    if (!employee) {
      return 0;
    }

    return this.records.filter(record =>
      record.employee_id === employee.id &&
      record.approval_status === 'approved' &&
      Number(record.earned_amount) > 0 &&
      record.attendance_date >=
        this.receiptStartDate() &&
      record.attendance_date <=
        this.receiptEndDate()
    ).length;
  }

  receiptPeriodEarnings(): number {
    const employee =
      this.receiptEmployee();

    if (!employee) {
      return 0;
    }

    return this.records
      .filter(record =>
        record.employee_id === employee.id &&
        record.approval_status === 'approved' &&
        record.attendance_date >=
          this.receiptStartDate() &&
        record.attendance_date <=
          this.receiptEndDate()
      )
      .reduce(
        (total, record) =>
          total +
          Number(
            record.earned_amount || 0
          ),
        0
      );
  }

  receiptPreviousBalance(): number {
    const employee =
      this.receiptEmployee();

    if (!employee) {
      return 0;
    }

    const start =
      this.receiptStartDate();

    const earnedBeforePeriod =
      this.records
        .filter(record =>
          record.employee_id === employee.id &&
          record.approval_status === 'approved' &&
          record.attendance_date < start
        )
        .reduce(
          (total, record) =>
            total +
            Number(
              record.earned_amount || 0
            ),
          0
        );

    const paidBeforePeriod =
      this.allPayments
        .filter(payment =>
          payment.employee_id === employee.id &&
          payment.status === 'completed' &&
          payment.payment_date < start
        )
        .reduce(
          (total, payment) =>
            total +
            Number(
              payment.amount || 0
            ),
          0
        );

    return (
      earnedBeforePeriod -
      paidBeforePeriod
    );
  }

  receiptMonthlyPaid(): number {
    return this.receiptMonthPayments()
      .reduce(
        (total, payment) =>
          total +
          Number(
            payment.amount || 0
          ),
        0
      );
  }

  receiptRemainingBalance(): number {
    return (
      this.receiptPreviousBalance() +
      this.receiptPeriodEarnings() -
      this.receiptMonthlyPaid()
    );
  }

  // ---------------------------------------------------------
  // TEMPLATE COMPATIBILITY METHODS
  // ---------------------------------------------------------

  periodLabel(): string {
    return (
      `${this.formatReceiptDate(
        this.receiptStartDate()
      )} – ` +
      `${this.formatReceiptDate(
        this.receiptEndDate()
      )}`
    );
  }

  selectedPeriodPayments(): Payment[] {
    return this.receiptMonthPayments();
  }

  selectedPayment(): Payment | null {
    return this.receiptPayment();
  }

  periodStart(): string {
    return this.receiptStartDate();
  }

  periodEnd(): string {
    return this.receiptEndDate();
  }

  workDays(): number {
    return this.receiptWorkDays();
  }

  periodEarnings(): number {
    return this.receiptPeriodEarnings();
  }

  previousBalance(): number {
    return this.receiptPreviousBalance();
  }

  monthlyPaid(): number {
    return this.receiptMonthlyPaid();
  }

  remainingBalance(): number {
    return this.receiptRemainingBalance();
  }

  // ---------------------------------------------------------
  // PERIOD VALIDATION
  // ---------------------------------------------------------

  saveReceiptPeriod(): void {

    if (
      this.receiptStartDate() >
      this.receiptEndDate()
    ) {
      this.error.set(
        'Receipt start date cannot be after the end date.'
      );
      return;
    }

    const payment =
      this.receiptPayment();

    if (
      payment &&
      this.receiptEndDate() >
        payment.payment_date
    ) {
      this.error.set(
        'Receipt period cannot end after the payment date.'
      );
      return;
    }

    this.error.set('');
  }

  // ---------------------------------------------------------
  // FORMATTING
  // ---------------------------------------------------------

  currency(
    value: number | string
  ): string {
    return new Intl.NumberFormat(
      'en-IN',
      {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0
      }
    ).format(
      Number(value) || 0
    );
  }

  toNumber(
    value: number | string
  ): number {
    return Number(value) || 0;
  }

  formatReceiptDate(
    value: string
  ): string {

    if (!value) {
      return '—';
    }

    const date = new Date(
      `${value}T00:00:00`
    );

    if (
      Number.isNaN(
        date.getTime()
      )
    ) {
      return value;
    }

    return date.toLocaleDateString(
      'en-IN',
      {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      }
    );
  }

  paymentMethodLabel(
    value: string
  ): string {
    return String(value || '—')
      .replace(/_/g, ' ')
      .replace(
        /\b\w/g,
        letter =>
          letter.toUpperCase()
      );
  }

  // ---------------------------------------------------------
  // PDF GENERATION
  // ---------------------------------------------------------

  private pdfEscape(
    value: string
  ): string {
    return String(value)
      .replace(
        /\\/g,
        '\\\\'
      )
      .replace(
        /\(/g,
        '\\('
      )
      .replace(
        /\)/g,
        '\\)'
      );
  }

  private makeReceiptPdf(): Blob | null {

    const employee =
      this.receiptEmployee();

    if (!employee) {
      return null;
    }

    const esc = (
      value: string
    ): string =>
      this.pdfEscape(
        value.replace(
          /₹/g,
          'Rs.'
        )
      );

    const left = 42;

    const right = 553;

    const contentWidth =
      right - left;

    const commands: string[] = [];

    /*
     * Every text command is generated
     * inside BT / ET.
     */
    const text = (
      value: string,
      x: number,
      y: number,
      size = 10,
      bold = false
    ): void => {

      commands.push(
        `BT /${bold ? 'F2' : 'F1'} ${size} Tf 1 0 0 1 ${x} ${y} Tm (${esc(value)}) Tj ET`
      );
    };

    const line = (
      x1: number,
      y1: number,
      x2: number,
      y2: number
    ): void => {

      commands.push(
        `${x1} ${y1} m ${x2} ${y2} l S`
      );
    };

    const fillRect = (
      x: number,
      y: number,
      width: number,
      height: number,
      r: number,
      g: number,
      b: number
    ): void => {

      commands.push(
        `${r} ${g} ${b} rg ${x} ${y} ${width} ${height} re f 0 0 0 rg`
      );
    };

    const strokeRect = (
      x: number,
      y: number,
      width: number,
      height: number
    ): void => {

      commands.push(
        `${x} ${y} ${width} ${height} re S`
      );
    };

    // -------------------------------------------------------
    // HEADER
    // -------------------------------------------------------

    fillRect(
      left,
      758,
      56,
      56,
      0.06,
      0.17,
      0.14
    );

    text(
      'SG',
      left + 14,
      779,
      20,
      true
    );

    text(
      'SURAKSHA GROUP',
      left + 70,
      796,
      13,
      true
    );

    text(
      'PAYMENT RECEIPT',
      left + 70,
      776,
      21,
      true
    );

    text(
      'Employee wage payment statement',
      left + 70,
      759,
      9
    );

    text(
      'RECEIPT NO.',
      420,
      797,
      8,
      true
    );

    text(
      this.receiptNumber(),
      420,
      782,
      11,
      true
    );

    text(
      this.formatReceiptDate(
        this.receiptPayment()?.payment_date || ''
      ),
      420,
      766,
      9
    );

    line(
      left,
      744,
      right,
      744
    );

    // -------------------------------------------------------
    // EMPLOYEE INFORMATION
    // -------------------------------------------------------

    fillRect(
      left,
      650,
      contentWidth,
      72,
      0.965,
      0.976,
      0.969
    );

    strokeRect(
      left,
      650,
      contentWidth,
      72
    );

    text(
      'EMPLOYEE',
      left + 14,
      701,
      8,
      true
    );

    text(
      employee.name,
      left + 14,
      684,
      13,
      true
    );

    text(
      `${employee.employee_code} | ${employee.mobile || 'Mobile not available'}`,
      left + 14,
      668,
      9
    );

    text(
      'DAILY RATE',
      390,
      701,
      8,
      true
    );

    text(
      this.currency(
        employee.default_daily_rate
      ),
      390,
      684,
      12,
      true
    );

    // -------------------------------------------------------
    // PERIOD
    // -------------------------------------------------------

    text(
      'STATEMENT PERIOD',
      left,
      625,
      8,
      true
    );

    text(
      `${this.formatReceiptDate(
        this.receiptStartDate()
      )} - ${this.formatReceiptDate(
        this.receiptEndDate()
      )}`,
      left,
      607,
      12,
      true
    );

    text(
      `Approved work days: ${this.receiptWorkDays()}`,
      390,
      607,
      9
    );

    line(
      left,
      590,
      right,
      590
    );

    // -------------------------------------------------------
    // FINANCIAL SUMMARY
    // -------------------------------------------------------

    text(
      'PAYMENT SUMMARY',
      left,
      570,
      9,
      true
    );

    const previousBalance =
      this.receiptPreviousBalance();

    const rows: Array<
      [string, string]
    > = [
      [
        'Earnings in selected period',
        this.currency(
          this.receiptPeriodEarnings()
        )
      ],
      [
        previousBalance < 0
          ? 'Previous advance'
          : 'Previous outstanding',
        this.currency(
          Math.abs(previousBalance)
        )
      ],
      [
        'Payments made in selected period',
        this.currency(
          this.receiptMonthlyPaid()
        )
      ]
    ];

    let y = 546;

    rows.forEach(
      ([label, value]) => {

        text(
          label,
          left + 4,
          y,
          10
        );

        text(
          value,
          450,
          y,
          10,
          true
        );

        line(
          left,
          y - 10,
          right,
          y - 10
        );

        y -= 30;
      }
    );

    const balance =
      this.receiptRemainingBalance();

    fillRect(
      left,
      y - 5,
      contentWidth,
      45,
      balance < 0 ? 1 : 0.93,
      balance < 0 ? 0.96 : 0.965,
      balance < 0 ? 0.95 : 0.94
    );

    text(
      balance < 0
        ? 'REMAINING ADVANCE'
        : 'REMAINING BALANCE',
      left + 14,
      y + 17,
      9,
      true
    );

    text(
      this.currency(
        Math.abs(balance)
      ),
      430,
      y + 14,
      15,
      true
    );

    y -= 68;

    // -------------------------------------------------------
    // PAYMENT ACTIVITY
    // -------------------------------------------------------

    const periodPayments =
      this.receiptMonthPayments();

    text(
      'PAYMENT ACTIVITY',
      left,
      y,
      9,
      true
    );

    y -= 20;

    text(
      'DATE',
      left,
      y,
      8,
      true
    );

    text(
      'METHOD',
      285,
      y,
      8,
      true
    );

    text(
      'AMOUNT',
      460,
      y,
      8,
      true
    );

    line(
      left,
      y - 7,
      right,
      y - 7
    );

    y -= 24;

    periodPayments
      .slice(0, 12)
      .forEach(
        payment => {

          text(
            this.formatReceiptDate(
              payment.payment_date
            ),
            left,
            y,
            9
          );

          text(
            this.paymentMethodLabel(
              payment.payment_method
            ),
            285,
            y,
            9
          );

          text(
            this.currency(
              payment.amount
            ),
            460,
            y,
            9,
            true
          );

          y -= 20;
        }
      );

    if (
      periodPayments.length > 12
    ) {

      text(
        `+ ${periodPayments.length - 12} more payment(s)`,
        left,
        y,
        8
      );

      y -= 20;
    }

    // -------------------------------------------------------
    // FOOTER
    // -------------------------------------------------------

    line(
      left,
      92,
      right,
      92
    );

    text(
      'For enquiry & assistance',
      left,
      74,
      8,
      true
    );

    text(
      'Pradeep Vishwakarma | Mo. 9506629814',
      left,
      58,
      8
    );

    text(
      'Praveen Pandey | Mo. 8090272727',
      left,
      44,
      8
    );

    text(
      'www.surakshawalls.space',
      390,
      58,
      8,
      true
    );

    text(
      'Computer-generated receipt issued by Suraksha Group',
      170,
      25,
      7
    );

    // -------------------------------------------------------
    // PDF OBJECTS
    // -------------------------------------------------------

    const content = [
      'q',
      '0 0 0 RG',
      '0.7 w',
      ...commands,
      'Q'
    ].join('\n');

    const objects: string[] = [

      '<< /Type /Catalog /Pages 2 0 R >>',

      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',

      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',

      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',

      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',

      `<< /Length ${content.length} >>
stream
${content}
endstream`
    ];

    let pdf =
      '%PDF-1.4\n';

    const offsets: number[] = [0];

    objects.forEach(
      (object, index) => {

        offsets.push(
          pdf.length
        );

        pdf +=
          `${index + 1} 0 obj\n` +
          `${object}\n` +
          `endobj\n`;
      }
    );

    const xref =
      pdf.length;

    pdf +=
      `xref\n` +
      `0 ${objects.length + 1}\n` +
      `0000000000 65535 f \n`;

    offsets
      .slice(1)
      .forEach(
        offset => {

          pdf +=
            `${String(offset).padStart(10, '0')} 00000 n \n`;
        }
      );

    pdf +=
      `trailer\n` +
      `<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
      `startxref\n` +
      `${xref}\n` +
      `%%EOF`;

    return new Blob(
      [pdf],
      {
        type: 'application/pdf'
      }
    );
  }

  // ---------------------------------------------------------
  // DOWNLOAD PDF
  // ---------------------------------------------------------

  downloadReceiptPdf(): void {

    const pdf =
      this.makeReceiptPdf();

    const employee =
      this.receiptEmployee();

    if (!pdf || !employee) {
      this.error.set(
        'Open a receipt before downloading the PDF.'
      );
      return;
    }

    const url =
      URL.createObjectURL(pdf);

    const anchor =
      document.createElement('a');

    anchor.href = url;

    anchor.download =
      `${this.receiptNumber()}-${employee.employee_code}.pdf`;

    anchor.style.display =
      'none';

    document.body.appendChild(
      anchor
    );

    anchor.click();

    anchor.remove();

    setTimeout(
      () =>
        URL.revokeObjectURL(url),
      1000
    );
  }

  downloadReceiptForPayment(
    payment: Payment
  ): void {

    this.openReceipt(payment);

    setTimeout(
      () =>
        this.downloadReceiptPdf(),
      100
    );
  }

  printReceiptForPayment(
    payment: Payment
  ): void {

    this.downloadReceiptForPayment(
      payment
    );
  }

  printReceipt(): void {
    this.downloadReceiptPdf();
  }

  // ---------------------------------------------------------
  // UPI
  // ---------------------------------------------------------

  private normalizeIndianMobile(
    value: string
  ): string | null {

    const digits =
      String(value || '')
        .replace(
          /\D/g,
          ''
        );

    if (digits.length === 10) {
      return `91${digits}`;
    }

    if (
      digits.length === 11 &&
      digits.startsWith('0')
    ) {
      return `91${digits.slice(1)}`;
    }

    if (
      digits.length === 12 &&
      digits.startsWith('91')
    ) {
      return digits;
    }

    return null;
  }

  payEmployeeViaUpi(): void {

    const employee = this.receiptEmployee();

    if (!employee) {
      this.error.set('Open an employee receipt first.');
      return;
    }

    const mobile = this.normalizeIndianMobile(employee.mobile || '');

    if (!mobile) {
      this.error.set('A valid 10-digit Indian mobile number is required for UPI payment.');
      return;
    }

    // Pre-fill the amount still payable. The admin can change it before paying.
    const suggestedAmount = Math.max(
      0,
      this.receiptRemainingBalance()
    );

    this.upiAmount.set(suggestedAmount);
    this.upiMobile.set(mobile.slice(2));
    this.upiStatus.set('');
    this.error.set('');
    this.showUpiPayment.set(true);
  }

  closeUpiPayment(): void {
    this.showUpiPayment.set(false);
    this.upiStatus.set('');
    this.error.set('');
  }

  async copyUpiMobile(): Promise<void> {
    const mobile = this.upiMobile();

    if (!mobile) {
      this.error.set('Employee mobile number is unavailable.');
      return;
    }

    try {
      await navigator.clipboard.writeText(mobile);
      this.upiStatus.set('Mobile number copied. Open your UPI app and search this number.');
    } catch {
      this.upiStatus.set(`Search this mobile number in your UPI app: ${mobile}`);
    }
  }

  async openUpiApp(): Promise<void> {
    const employee = this.receiptEmployee();
    const mobile = this.upiMobile();
    const amount = Number(this.upiAmount());

    if (!employee || !mobile) {
      this.error.set('Employee mobile number is unavailable.');
      return;
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      this.error.set('Enter a valid payment amount greater than ₹0.');
      return;
    }

    // UPI's standard web deep-link requires a payee VPA in `pa`. A phone
    // number is resolved by the UPI app's own phone-number/UPI-Number flow,
    // so we must not invent a value such as 9876543210@upi.
    // Copy the recipient number first, then hand the user to the installed
    // UPI app chooser when the browser exposes the generic UPI scheme.
    await this.copyUpiMobile();

    const note = `Suraksha Group payment - ${employee.name}`;

    // We intentionally do not create a fake UPI payment URI here.
    // Without a verified payee VPA, a generic `upi://pay` link cannot
    // guarantee mobile-number resolution. The copied number is the reliable
    // identifier that the selected UPI app can search/resolve.
    this.upiStatus.set(
      `Recipient: ${mobile}. Open Google Pay, PhonePe, Paytm or BHIM, search this number, verify ${employee.name}, then pay ${this.currency(amount)}. ${note}`
    );
  }

  // ---------------------------------------------------------
  // WHATSAPP
  // ---------------------------------------------------------

  async shareReceiptWhatsApp(
    payment: Payment =
      this.receiptPayment() as Payment
  ): Promise<void> {

    if (!payment) {
      this.error.set(
        'Open a receipt first.'
      );
      return;
    }

    this.openReceipt(payment);

    const employee =
      this.employeeForPayment(
        payment.employee_id
      );

    if (!employee?.mobile) {
      this.error.set(
        'This employee has no mobile number.'
      );
      return;
    }

    /*
     * Give Angular/browser a moment to update
     * the selected receipt before generating
     * the PDF.
     */
    await new Promise<void>(
      resolve =>
        setTimeout(
          resolve,
          180
        )
    );

    const pdf =
      this.makeReceiptPdf();

    const file =
      pdf
        ? new File(
            [
              pdf
            ],
            `${this.receiptNumber()}-${employee.employee_code}.pdf`,
            {
              type: 'application/pdf'
            }
          )
        : null;

    const nav =
      navigator as Navigator & {
        share?: (
          data: ShareData
        ) => Promise<void>;

        canShare?: (
          data?: ShareData
        ) => boolean;
      };

    if (
      file &&
      nav.share &&
      (
        !nav.canShare ||
        nav.canShare({
          files: [file]
        })
      )
    ) {

      try {

        await nav.share({
          title:
            `Suraksha Group - ${this.receiptNumber()}`,

          text:
            `Monthly wage statement for ${employee.name}`,

          files: [file]
        });

        return;

      } catch {
        /*
         * User cancelled native sharing or
         * browser does not support this type
         * of sharing.
         *
         * Continue to WhatsApp fallback.
         */
      }
    }

    const mobile =
      this.normalizeIndianMobile(
        employee.mobile
      );

    if (!mobile) {
      this.error.set(
        'Employee mobile number is invalid. Enter a valid 10-digit Indian mobile number.'
      );
      return;
    }

    const balance =
      this.receiptRemainingBalance();

    const text =
      `SURAKSHA GROUP – PAYMENT RECEIPT
Receipt: ${this.receiptNumber()}
Employee: ${employee.name} (${employee.employee_code})
Period: ${this.formatReceiptDate(this.receiptStartDate())} to ${this.formatReceiptDate(this.receiptEndDate())}
Work days: ${this.receiptWorkDays()}
Period earnings: ${this.currency(this.receiptPeriodEarnings())}
Payment made: ${this.currency(this.receiptMonthlyPaid())}
${balance < 0 ? 'Remaining advance' : 'Remaining balance'}: ${this.currency(Math.abs(balance))}`;

    /*
     * WhatsApp requires the international
     * number without +.
     */
    window.location.href =
      `https://wa.me/${mobile}?text=${encodeURIComponent(
        text
      )}`;
  }

  // ---------------------------------------------------------
  // HELPERS
  // ---------------------------------------------------------

  private today(): string {

    const now =
      new Date();

    const year =
      now.getFullYear();

    const month =
      String(
        now.getMonth() + 1
      ).padStart(
        2,
        '0'
      );

    const day =
      String(
        now.getDate()
      ).padStart(
        2,
        '0'
      );

    return (
      `${year}-${month}-${day}`
    );
  }

  refresh(): void {
    this.refreshRequested.emit();
  }

  clearError(): void {
    this.error.set('');
  }

  clearMessage(): void {
    this.message.set('');
  }
}