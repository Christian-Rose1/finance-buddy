/**
 * Product categorization for extracted receipt LINE ITEMS.
 *
 * This operates on individual purchased products (e.g. "DOG TREAT",
 * "ORANGES"), NOT merchant-level credit-card transactions. Classification
 * is deterministic, keyword-based, and case-insensitive. No AI is used.
 *
 * Every existing field on each `ReceiptItem` is preserved; only `category`
 * is updated.
 */

import type { ReceiptItem } from "./types";

/** Spending categories for receipt line items. */
export type ReceiptCategory =
  | "Groceries"
  | "Dining"
  | "Household"
  | "Personal Care"
  | "Pet"
  | "Electronics"
  | "Clothing"
  | "Health"
  | "Entertainment"
  | "Travel"
  | "Other";

/**
 * Ordered keyword rules. The first matching rule wins. Rules are ordered so
 * that more specific product signals are not shadowed by broader ones (e.g.
 * pet/health keywords are checked before retail groceries substrings).
 */
const RULES: { category: ReceiptCategory; keywords: string[] }[] = [
  {
    // Pet products and pet-food specific strings first (e.g. "DRY DOG",
    // "DOG TREAT", "FLOPPY PUPPY", "PET TOY").
    category: "Pet",
    keywords: [
      "dog", "cat", "puppy", "kitten", "kibble", "pet", "treat",
      "litter", "leash", "collar", "aquarium", "fish food", "bird seed",
      "hamster", "guinea pig", "reptile", "veterinary",
    ],
  },
  {
    // Health & pharmacy items (medications, vitamins, supplements).
    category: "Health",
    keywords: [
      "vitamin", "supplement", "medicine", "medication", "aspirin",
      "ibuprofen", "tylenol", "advil", "probiotic", "bandaid", "bandage",
      "first aid", "thermometer", "pill", "capsule", "syrup", "allergy",
      "cold & flu", "pain relief", "pharmacy", "prescription", "contact lens",
      "eye drops", "antacid", "cough", "decongestant", "sunscreen",
    ],
  },
  {
    // Electronics.
    category: "Electronics",
    keywords: [
      "headphone", "earbud", "airpod", "speaker", "phone", "iphone",
      "samsung", "laptop", "computer", "tablet", "ipad", "kindle",
      "keyboard", "mouse", "monitor", "tv ", "television", "camera",
      "charger", "cable", "usb", "ssd", "hard drive", "memory card",
      "router", "smartwatch", "apple watch", "gaming console", "playstation",
      "xbox", "drone", "screen protector", "power bank",
    ],
  },
  {
    // Clothing & apparel.
    category: "Clothing",
    keywords: [
      "shirt", "t-shirt", "tshirt", "pants", "jeans", "shorts", "skirt",
      "dress", "jacket", "hoodie", "sweater", "coat", "socks", "underwear",
      "gloves", "scarf", "hat ", "cap ", "shoe", "sneaker", "boot",
      "sandal", "belt", "tie ", "blouse", "sweatpants", "leggings",
      "swimsuit", "pajama", "sock",
    ],
  },
  {
    // Household / cleaning / kitchen products.
    category: "Household",
    keywords: [
      "detergent", "soap", "cleaner", "cleaning", "paper towel",
      "paper towels", "tissue", "toilet paper", "napkin", "trash bag",
      "garbage bag", "sponge", "broom", "mop", "wipes", "bleach",
      "dishwasher", "laundry", "fabric softener", "light bulb", "battery",
      "ziploc", "aluminum foil", "saran wrap", "air freshener", "kitchen",
      "container", "sponge",
    ],
  },
  {
    // Personal care & grooming.
    category: "Personal Care",
    keywords: [
      "shampoo", "conditioner", "toothpaste", "toothbrush", "deodorant",
      "body wash", "lotion", "moisturizer", "razor", "shaving", "lip balm",
      "makeup", "foundation", "lipstick", "mascara", "nail polish",
      "cotton swab", "mouthwash", "floss", "hair", "brush", "comb",
      "perfume", "cologne", "face wash", "cleanser", "serum",
    ],
  },
  {
    // Entertainment / media / hobbies.
    category: "Entertainment",
    keywords: [
      "movie", "cinema", "theater", "netflix", "spotify", "hulu", "disney",
      "gaming", "video game", "book", "magazine", "newspaper", "toy",
      "board game", "puzzle", "concert", "ticket", "streaming", "youtube",
      "audible", "kindle",
    ],
  },
  {
    // Travel & transport.
    category: "Travel",
    keywords: [
      "flight", "airfare", "hotel", "motel", "airbnb", "rental car",
      "uber", "lyft", "taxi", "parking", "toll", "train", "bus",
      "ferry", "luggage", "suitcase", "resort", "vacation", "airline",
      "expedia", "booking", "gas station", "gasoline", "subway pass",
    ],
  },
  {
    // Dining / prepared food eaten out / delivery.
    category: "Dining",
    keywords: [
      "burger", "pizza", "sushi", "taco", "sandwich", "restaurant",
      "starbucks", "coffee shop", "cafe", "lunch", "dinner", "breakfast",
      "takeout", "delivery", "doordash", "uber eats", "grubhub", "kfc",
      "mcdonald", "wendy", "chipotle", "panera", "thai", "chinese",
      "indian", "mexican", "italian", "dunkin",
    ],
  },
  {
    // Groceries / retail food items (checked after the more specific
    // categories above so prepared-food or brand signals win).
    category: "Groceries",
    keywords: [
      "milk", "bread", "eggs", "butter", "cheese", "yogurt", "fruit",
      "apple", "banana", "orange", "grape", "berry", "berries", "carrot",
      "carrots", "collard", "collards", "lettuce", "tomato", "onion",
      "potato", "broccoli", "spinach", "kale", "cucumber", "pepper",
      "garlic", "vegetable", "meat", "chicken", "beef", "pork", "turkey",
      "fish", "salmon", "shrimp", "pasta", "rice", "cereal", "oat",
      "granola", "flour", "sugar", "salt", "spice", "oil", "vinegar",
      "sauce", "soup", "snack", "chips", "cracker", "cookie", "biscuit",
      "cake", "chocolate", "candy", "ice cream", "juice", "soda", "water",
      "beer", "wine", "honey", "jam", "peanut butter", "tofu", "salad",
      "bagel", "muffin", "tortilla", "salsa", "avocado", "calzone",
      "produce", "deli", "seafood", "frozen",
    ],
  },
];

/** Lowercases a value for matching; tolerant of null/non-string input. */
function normalize(value: string | null | undefined): string {
  return (value ?? "").toLowerCase();
}

/** Assign a category to a single product name. Deterministic, case-insensitive. */
export function categorizeItem(name: string | null): ReceiptCategory {
  const product = normalize(name).trim();

  if (product.length === 0) {
    return "Other";
  }

  for (const { category, keywords } of RULES) {
    for (const keyword of keywords) {
      // Substring match with normalized keyword; ensures case-insensitivity.
      if (product.includes(keyword)) {
        return category;
      }
    }
  }

  return "Other";
}

/**
 * Categorizes every item in a receipt.
 *
 * Returns a NEW array (original is not mutated). All existing fields are
 * preserved; only `category` is updated to a `ReceiptCategory`.
 */
export function categorizeReceiptItems(items: ReceiptItem[]): ReceiptItem[] {
  return items.map((item) => ({
    ...item,
    category: categorizeItem(item.name),
  }));
}