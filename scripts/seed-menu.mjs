import admin from 'firebase-admin';
import { readFileSync } from 'fs';

const SERVICE_ACCOUNT_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!SERVICE_ACCOUNT_PATH) {
  console.error('Missing GOOGLE_APPLICATION_CREDENTIALS env var. Point it to your Firebase service account JSON.');
  process.exit(1);
}

const serviceAccount = JSON.parse(readFileSync(SERVICE_ACCOUNT_PATH, 'utf-8'));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const MENU_ITEMS = [
  {
    id: 1, name: 'Beef Cheek Rendang', description: 'Slow-braised beef cheek in coconut and lemongrass, served with turmeric rice and sambal matah.', price: 245000, category: 'Signatures', image: '', tag: 'Signature', allergens: 'Coconut, Nuts', prepTime: '25–30 min', spiceLevel: 'Medium', serviceTag: 'Chef Recommendation', dietaryTags: ['Contains Nuts'], timeSlots: ['afternoon', 'evening'],
  },
  {
    id: 2, name: 'Pan-Seared Barramundi', description: 'Crisp-skin barramundi with lemon beurre blanc, roasted vegetables, and herb oil.', price: 285000, category: 'Signatures', image: '', tag: 'Signature', allergens: 'Fish, Dairy', timeSlots: ['afternoon', 'evening'],
  },
  {
    id: 3, name: 'Lobster Thermidor', description: 'Fresh lobster tail baked with a creamy gruyère sauce, served with garlic butter rice and asparagus.', price: 425000, category: 'Signatures', image: '', tag: "Chef's Choice", allergens: 'Seafood, Dairy', timeSlots: ['evening'],
  },
  {
    id: 4, name: 'Wagyu Striploin 200g', description: 'Australian Wagyu MB5 with roasted shallots, broccolini, and red wine jus.', price: 385000, category: 'Signatures', image: '', tag: 'Premium', allergens: 'Dairy', prepTime: '20–25 min', spiceLevel: 'None', serviceTag: 'Best Seller', dietaryTags: ['Gluten-Free Option'], timeSlots: ['evening'],
  },
  {
    id: 5, name: 'Oxtail Soup', description: 'Traditional slow-simmered oxtail broth with root vegetables, served with steamed rice and crackers.', price: 195000, category: 'Signatures', image: '', tag: 'Local Heritage', allergens: '', timeSlots: ['latenight'],
  },
  {
    id: 6, name: 'Classic Caesar Salad', description: 'Romaine hearts, aged parmesan, focaccia croutons, and anchovy dressing.', price: 85000, category: 'Starters', image: '', tag: '', allergens: 'Dairy, Egg, Fish', timeSlots: ['morning', 'afternoon'],
  },
  {
    id: 7, name: 'Cream of Mushroom Soup', description: 'Wild mushroom velouté with truffle oil and garlic crostini.', price: 75000, category: 'Starters', image: '', tag: '', allergens: 'Dairy', timeSlots: ['evening', 'latenight'],
  },
  {
    id: 8, name: 'Gado Gado', description: 'Steamed vegetables, tofu, and egg with house-made peanut dressing and shrimp crackers.', price: 65000, category: 'Starters', image: '', tag: 'Vegetarian', allergens: 'Peanut, Egg', prepTime: '15 min', spiceLevel: 'Mild', serviceTag: 'Local Favourite', dietaryTags: ['Vegetarian', 'Contains Nuts'], timeSlots: ['morning', 'afternoon'],
  },
  {
    id: 9, name: 'Salt and Pepper Calamari', description: 'Crisp-fried squid rings with aioli and charred lemon.', price: 85000, category: 'Starters', image: '', tag: '', allergens: 'Seafood, Wheat', timeSlots: ['afternoon', 'evening'],
  },
  {
    id: 10, name: 'Tomato Bruschetta', description: 'Toasted sourdough with heirloom tomatoes, basil, balsamic, and olive oil.', price: 65000, category: 'Starters', image: '', tag: '', allergens: 'Wheat', timeSlots: ['morning'],
  },
  {
    id: 11, name: 'Honey-Glazed Chicken Wings', description: 'Roasted wings with honey, soy, and ginger glaze, served with pickled daikon.', price: 85000, category: 'Starters', image: '', tag: 'Popular', allergens: 'Soy', timeSlots: ['afternoon', 'evening', 'latenight'],
  },
  {
    id: 12, name: 'Nasi Goreng Kampung', description: 'Village-style fried rice with chicken satay, fried egg, prawn crackers, and sambal.', price: 145000, category: 'Mains', image: '', tag: 'Local Favourite', allergens: 'Egg, Peanut, Shrimp', timeSlots: ['morning', 'afternoon'],
  },
  {
    id: 13, name: 'Club Sandwich', description: 'Triple-decker with roast chicken, streaky bacon, herb mayo, and shoestring fries.', price: 155000, category: 'Mains', image: '', tag: '', allergens: 'Wheat, Egg', timeSlots: ['morning', 'latenight'],
  },
  {
    id: 14, name: 'Pan-Seared Salmon', description: 'Norwegian salmon fillet with lemon beurre blanc, mashed potato, and sautéed greens.', price: 265000, category: 'Mains', image: '', tag: '', allergens: 'Fish, Dairy', timeSlots: ['afternoon', 'evening'],
  },
  {
    id: 15, name: 'Australian Sirloin 200g', description: 'Chargrilled sirloin with roasted potatoes, broccolini, and peppercorn jus.', price: 325000, category: 'Mains', image: '', tag: '', allergens: 'Dairy', timeSlots: ['evening'],
  },
  {
    id: 16, name: 'Spaghetti Bolognese', description: 'Hand-rolled pasta with slow-cooked beef ragù and aged parmesan.', price: 145000, category: 'Mains', image: '', tag: '', allergens: 'Wheat, Dairy', timeSlots: ['afternoon', 'evening'],
  },
  {
    id: 17, name: 'Mie Goreng Jawa', description: 'Javanese stir-fried egg noodles with chicken, bok choy, and sweet soy glaze.', price: 125000, category: 'Mains', image: '', tag: 'Local', allergens: 'Wheat, Egg, Soy', timeSlots: ['afternoon', 'latenight'],
  },
  {
    id: 18, name: 'Smash Burger', description: 'Double smashed beef patty with aged cheddar, caramelised onion, and truffle fries.', price: 165000, category: 'Mains', image: '', tag: '', allergens: 'Wheat, Dairy', timeSlots: ['afternoon', 'evening', 'latenight'],
  },
  {
    id: 19, name: 'Fish and Chips', description: 'Beer-battered barramundi with thick-cut fries, mushy peas, and tartare sauce.', price: 155000, category: 'Mains', image: '', tag: '', allergens: 'Fish, Wheat', timeSlots: ['afternoon', 'latenight'],
  },
  {
    id: 20, name: 'Vanilla Bean Cheesecake', description: 'Baked cheesecake with mixed berry compote and vanilla cream.', price: 95000, category: 'Desserts', image: '', tag: '', allergens: 'Dairy, Wheat', timeSlots: ['afternoon', 'evening'],
  },
  {
    id: 21, name: 'Chocolate Lava Cake', description: 'Dark chocolate fondant with molten centre, served with vanilla bean ice cream.', price: 95000, category: 'Desserts', image: '', tag: 'Popular', allergens: 'Dairy, Egg, Wheat', timeSlots: ['evening', 'latenight'],
  },
  {
    id: 22, name: 'Crème Brûlée', description: 'Classic French custard with caramelised sugar crust and fresh berries.', price: 85000, category: 'Desserts', image: '', tag: '', allergens: 'Dairy, Egg', timeSlots: ['evening'],
  },
  {
    id: 23, name: 'Tropical Fruit Platter', description: 'Seasonal hand-cut fruits with lime zest and coconut sorbet.', price: 75000, category: 'Desserts', image: '', tag: 'Light', allergens: '', timeSlots: ['morning', 'afternoon'],
  },
  {
    id: 24, name: 'Es Campur', description: 'Indonesian iced dessert with coconut jelly, palm fruit, and pandan syrup.', price: 75000, category: 'Desserts', image: '', tag: 'Local', allergens: 'Coconut', timeSlots: ['afternoon'],
  },
  {
    id: 25, name: 'Flat White', description: 'Double-shot espresso with steamed milk.', price: 55000, category: 'Beverages', image: '', tag: '', allergens: 'Dairy', timeSlots: ['morning', 'afternoon'],
  },
  {
    id: 26, name: 'Fresh Orange Juice', description: 'Hand-squeezed orange juice, served chilled.', price: 65000, category: 'Beverages', image: '', tag: '', allergens: '', timeSlots: ['morning'],
  },
  {
    id: 27, name: 'Virgin Mojito', description: 'Muddled lime and mint with soda and palm sugar syrup.', price: 75000, category: 'Beverages', image: '', tag: '', allergens: '', timeSlots: ['afternoon', 'evening'],
  },
  {
    id: 28, name: 'Hot Chocolate', description: 'Single-origin cocoa with steamed milk and marshmallow.', price: 55000, category: 'Beverages', image: '', tag: '', allergens: 'Dairy', timeSlots: ['evening', 'latenight'],
  },
  {
    id: 29, name: 'Wedang Jahe', description: 'Traditional ginger tea with palm sugar and lemongrass.', price: 45000, category: 'Beverages', image: '', tag: 'Local', allergens: '', timeSlots: ['morning', 'evening', 'latenight'],
  },
  {
    id: 30, name: 'Sparkling Water', description: 'Premium sparkling mineral water (380ml).', price: 45000, category: 'Beverages', image: '', tag: '', allergens: '', timeSlots: ['afternoon', 'evening'],
  },
];

async function seed() {
  const batch = db.batch();
  const productsRef = db.collection('products');

  for (const item of MENU_ITEMS) {
    const docRef = productsRef.doc(String(item.id));
    batch.set(docRef, {
      sourceItemId: String(item.id),
      name: item.name,
      category: item.category,
      price: item.price,
      image: item.image || '',
      description: item.description,
      isAvailable: true,
      unavailableReason: '',
      allergens: item.allergens || '',
      tag: item.tag || '',
      prepTime: item.prepTime || '',
      spiceLevel: item.spiceLevel || '',
      serviceTag: item.serviceTag || '',
      dietaryTags: item.dietaryTags || [],
      timeSlots: item.timeSlots || [],
    });
  }

  await batch.commit();
  console.log(`✅ Successfully seeded ${MENU_ITEMS.length} menu items into Firestore products collection.`);
  process.exit(0);
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
