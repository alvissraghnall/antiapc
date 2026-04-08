import {
  REASONS_PART1,
  REASONS_PART2,
  REASONS_PART3,
  REASONS_PART4,
  REASONS
} from '../src/raw'; // NOTE: Update to '../src/data' if you change your import structure later

const allData = [
  ...REASONS,
  ...REASONS_PART1,
  ...REASONS_PART2,
  ...REASONS_PART3,
  ...REASONS_PART4
];

async function seedDatabase() {
  // 1. Filter out placeholder '#' links to only seed items with real URLs
  const validItems = allData.filter(
    (item) => item.url && item.url !== '#' && item.url.startsWith('http')
  );

  console.log(`Found ${validItems.length} records with valid links. Starting seed...\n`);

  let successCount = 0;
  let failCount = 0;

  // 2. Iterate and POST to your local API endpoint
  for (const item of validItems) {
    try {
      const res = await fetch('http://localhost:9876/reasons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: item.cat, // Map 'cat' from raw data to 'category'
          text: item.text,
          source: item.source,
          url: item.url,
          impact_level: 'high', 
          priority: 1,
          verified: true, // Assuming if it has a real link, we consider it verified
          status: 'active'
        }),
      });

      if (res.ok) {
        successCount++;
        console.log(`✅ [${successCount}] Added: ${item.text.substring(0, 50)}...`);
      } else {
        failCount++;
        console.error(`❌ Failed: ${item.text.substring(0, 50)}... | Status: ${res.status}`);
      }
    } catch (error) {
      failCount++;
      console.error(`❌ Error connecting to API: ${error}`);
    }
  }

  console.log(`\n--- Seeding Complete ---`);
  console.log(`Successfully added: ${successCount}`);
  console.log(`Failed: ${failCount}`);
}

seedDatabase().catch(console.error);