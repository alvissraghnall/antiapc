// import { console, fetch } from '@cloudflare/workers-types';
import {
  REASONS_PART1,
  REASONS_PART2,
  REASONS_PART3,
  REASONS_PART4,
  REASONS
} from '../src/raw';

// Combine all your raw data arrays
const allRawData = [
  ...REASONS_PART1,
  ...REASONS_PART2,
  ...REASONS_PART3,
  ...REASONS_PART4,
  ...REASONS
];

async function verifyUrl(url: string): Promise<boolean> {
  try {
    // Efficiency Hack: Use HEAD request to only fetch headers, not the full HTML body
    let response = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    
    // Fallback: Some servers block HEAD requests and return 405 or 403. Try a GET if that happens.
    if (response.status === 405 || response.status === 403) {
      response = await fetch(url, { method: 'GET', redirect: 'follow' });
    }

    return response.ok; // true if status is 200-299
  } catch (error) {
    // Catches network errors, DNS issues, etc.
    return false; 
  }
}

async function runVerification() {
  console.log(`Loaded ${allRawData.length} total records to verify...`);

  // Hack: Extract UNIQUE, real URLs (Ignore '#' and empty strings)
  const uniqueUrls = new Set(
    allRawData
      .map((item) => item.url)
      .filter((url) => url && url !== '#' && url.startsWith('http'))
  );

  console.log(`Found ${uniqueUrls.size} unique URLs to verify. Checking now...\n`);

  // Hack: Verify unique URLs concurrently
  const urlCache = new Map<string, boolean>();
  const urlArray = Array.from(uniqueUrls);
  
  // Process in batches to avoid overwhelming the network or getting rate-limited
  const batchSize = 10;
  for (let i = 0; i < urlArray.length; i += batchSize) {
    const batch = urlArray.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (url) => {
        const isValid = await verifyUrl(url);
        return { url, isValid };
      })
    );

    for (const res of results) {
      urlCache.set(res.url, res.isValid);
      console.log(`[${res.isValid ? 'OK' : 'DEAD'}] ${res.url}`);
    }
  }

  console.log('\n--- Verification Summary ---');
  
  const invalidRecords = allRawData.filter((item) => {
    // Flag it if it's an actual URL that failed verification
    if (item.url && item.url !== '#' && item.url.startsWith('http')) {
      return urlCache.get(item.url) === false;
    }
    return false; // Skip '#' for this specific error report
  });

  console.log(`Found ${invalidRecords.length} records with dead/invalid links.`);
  if (invalidRecords.length > 0) {
    console.log(invalidRecords.map(r => `ID ${r.id}: ${r.url}`).join('\n'));
  }
}

runVerification().catch(console.error);