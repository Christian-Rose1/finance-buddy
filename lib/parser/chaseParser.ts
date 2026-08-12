export type ParsedTransaction = {
  date: string;
  merchant: string;
  amount: number;
  category: string;
  rawLine: string;
};

const transactionLineRegex =
  /^(?<date>\d{2}\/\d{2})\s+(?<merchant>.+?)\s+(?<amount>-?[\d,]+\.\d{2})$/;

function normalizeLine(line: string) {
  return line.replace(/\s+/g, " ").trim();
}

function isNoiseLine(merchant: string, rawLine: string) {
  const upperMerchant = merchant.toUpperCase();
  const upperLine = rawLine.toUpperCase();

  return [
    /PAYMENT THANK YOU/i,
    /TRANSACTION FEE/i,
    /CASH ADVANCE INTEREST/i,
    /INTEREST CHARGED/i,
    /TOTAL FEES/i,
    /TOTAL INTEREST/i,
    /YEAR-TO-DATE/i,
    /OPENING\/CLOSING DATE/i,
    /STATEMENT DATE/i,
    /ACCOUNT NUMBER/i,
    /CREDIT ACCESS LINE/i,
    /AVAILABLE CREDIT/i,
    /AVAILABLE FOR CASH/i,
    /PREVIOUS BALANCE/i,
    /PAYMENTS, CREDITS/i,
    /PURCHASES/i,
    /CASH ADVANCES/i,
    /BALANCE TRANSFERS/i,
    /EURO/i,
    /CANADIAN DOLLAR/i,
    /SWISS FRANC/i,
    /EXCHG RATE/i,
    /PAGE \d+ OF \d+/i,
    /AUTOPAY IS ON/i,
    /FIS33339/i,
    /CARDMEMBER SERVICE/i,
    /P\.O\. BOX/i,
    /MINIMUM PAYMENT/i,
    /LATE PAYMENT WARNING/i,
    /MINIMUM PAYMENT WARNING/i,
    /ANNUAL PERCENTAGE RATE/i,
  ].some((pattern) => pattern.test(upperMerchant) || pattern.test(upperLine));
}

function categorizeMerchant(merchant: string) {
  const upper = merchant.toUpperCase();

  if (
    /WHOLEFDS|WHOLE FOODS|SAFEWAY|COSTCO|INSTACART|TRADER JOE|LEEVERS LOCAVORE|SPROUTS|NATURALIA|TARGET|WALGREENS/i.test(
      upper
    )
  ) {
    return "Groceries";
  }

  if (
    /STARBUCKS|COFFEE|BAKERY|BAGEL|TAQUERIA|SUSHI|RESTAURANT|CAFE|ICE CREAM|BISTRO|DINING|FOOD|DANG SOFT SERVE|LITTLE MAN|ODELLS|MOONFLOWER|HUCKLEBERRY|MIDDLESTATE|JOY HILL|CLEMENTINES|PAPUSAS|TAKI|CHILI S|PARKING/i.test(
      upper
    )
  ) {
    return "Dining";
  }

  if (
    /AIRBNB|WESTJET|UBER|LIME|VEO|PARKINGCOM|RENTAPPLICATION|TRIP|FLIGHT|HOTEL|TRANSPORT|YYC|CDG|PARIS|LISBOA|GRINDELWALD|ANDERMATT/i.test(
      upper
    )
  ) {
    return "Travel / Transportation";
  }

  if (
    /APPLE\.COM\/BILL|COMCAST|KINDLE|NUULY|PROGRESSIVE|SUBSCRIP|STREAM|INS/i.test(
      upper
    )
  ) {
    return "Bills & Subscriptions";
  }

  if (
    /GAP|NEW BALANCE|MADEWELL|MICHAELS|YOGA BOX|FOXY NAILS|EYEBROW|UPS STORE|USPS|BLANK BARBERS|SHOP|TARGET\.COM|MERCADO|MART/i.test(
      upper
    )
  ) {
    return "Shopping";
  }

  if (
    /HEATING|PROPERT|SCHOOL BUS|APF\*|SERVICE NAVIGO|SELECTA|FLEUX|BOULANGERIE|PHARMACIE|LIME\*RIDE|SASQUATCH|COSTCO BY IN CAR|INSTACART.COM/i.test(
      upper
    )
  ) {
    return "Home / Services";
  }

  return "Other";
}

export function parseTransactions(text: string): ParsedTransaction[] {
  const lines = text
    .split(/\r?\n/)
    .map(normalizeLine)
    .filter(Boolean);

  const transactions: ParsedTransaction[] = [];

  for (const line of lines) {
    const match = line.match(transactionLineRegex);
    if (!match?.groups) continue;

    const date = match.groups.date;
    const merchant = match.groups.merchant.trim();
    const amount = Number(match.groups.amount.replace(/,/g, ""));

    if (!Number.isFinite(amount)) continue;
    if (isNoiseLine(merchant, line)) continue;

    transactions.push({
      date,
      merchant,
      amount,
      category: categorizeMerchant(merchant),
      rawLine: line,
    });
  }

  return transactions;
}