import fs from 'fs/promises';
import path from 'path';
import {
  REASONS_PART1,
  REASONS_PART2,
  REASONS_PART3,
  REASONS_PART4,
  REASONS
} from '../src/raw';

async function splitData() {
  const dataDir = path.join(import.meta.dir, '../src/data');
  await fs.mkdir(dataDir, { recursive: true });

  const writeChunk = async (filename: string, varName: string, data: any[]) => {
    const content = `export const ${varName} = ${JSON.stringify(data, null, 2)};\n`;
    await fs.writeFile(path.join(dataDir, filename), content, 'utf-8');
    console.log(`✅ Created ${filename} with ${data.length} records.`);
  };

  await writeChunk('part1.ts', 'REASONS_PART1', REASONS_PART1);
  await writeChunk('part2.ts', 'REASONS_PART2', REASONS_PART2);
  await writeChunk('part3.ts', 'REASONS_PART3', REASONS_PART3);
  await writeChunk('part4.ts', 'REASONS_PART4', REASONS_PART4);
  await writeChunk('part5.ts', 'REASONS', REASONS);

  const indexContent = `export * from './part1';\nexport * from './part2';\nexport * from './part3';\nexport * from './part4';\nexport * from './part5';\n`;
  await fs.writeFile(path.join(dataDir, 'index.ts'), indexContent, 'utf-8');
  
  console.log('\n🎉 Data successfully split into 5 files in src/data/');
}

splitData().catch(console.error);