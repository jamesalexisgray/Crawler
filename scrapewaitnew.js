const puppeteer = require('puppeteer-extra');
const fs = require('fs');
const path = require('path');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const inputFilePath = '/home/kali/input_sites.txt';
const outputFilePath = '/home/kali/links_output.txt';
const failedFilePath = '/home/kali/failed_sites.txt';

// Path to your Chrome profile
const chromeProfilePath = '/home/kali/.config/my-chrome-profile';

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function simulateHumanBehavior(page) {
  await page.mouse.move(100, 100);
  await delay(500);
  await page.mouse.move(200, 200);
  await delay(800);
  await page.mouse.move(300, 250);
  await delay(600);
}

async function scrapeLinksFromList(websites, outputStream, browser) {
  const failedWebsites = [];

  for (const website of websites) {
    try {
      console.log(`Scraping: ${website}`);
      const page = await browser.newPage();

      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36');
      await page.setViewport({ width: 1280, height: 800 });

      const maxRetries = 1;
      let retries = maxRetries;
      let success = false;

      while (retries > 0 && !success) {
        try {
          let response;
          if (retries === maxRetries) {
            response = await page.goto(website, { waitUntil: 'load', timeout: 45000 });
          } else {
            console.log('🔄 Reloading page...');
            response = await page.reload({ waitUntil: 'load', timeout: 45000 });
          }

          // Simulate human behavior
          await simulateHumanBehavior(page);
          await delay(3000);

          // Check HTTP status
          if (response && [403, 429].includes(response.status())) {
            throw new Error(`HTTP ${response.status()} - Access Blocked`);
          }

          // Check for common block phrases in body text
          const bodyText = await page.evaluate(() => document.body.innerText.toLowerCase());

          const blockIndicators = [
            'access denied',
            'verify you are human',
            'rate limit',
            'too many requests',
            'restricted access'
          ];

          if (blockIndicators.some(indicator => bodyText.includes(indicator))) {
            throw new Error('Page content indicates bot block');
          }

          await page.waitForSelector('a', { timeout: 5000 });

          const links = await page.evaluate(() => {
            const anchorElements = Array.from(document.querySelectorAll('a'));
            return anchorElements
              .map(anchor => anchor.href)
              .filter(href => href && href.startsWith('http'));
          });

          if (links.length > 0) {
            outputStream.write(`Links from: ${website}\n`);
            outputStream.write(links.join('\n') + '\n\n');
            console.log(`Found ${links.length} links from ${website}`);
          } else {
            console.log(`⚠No links found on ${website}`);
          }

          success = true;
        } catch (error) {
          console.warn(`Attempt failed for ${website}: ${error.message}`);

          // Take a screenshot for debugging
          const screenshotPath = `screenshot_${website.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.png`;
          await page.screenshot({ path: screenshotPath });
          console.log(`Screenshot saved: ${screenshotPath}`);

          retries--;

          if (retries > 0) {
            const waitTime = 3000 + Math.floor(Math.random() * 3000);
            console.log(`Retrying in ${waitTime / 1000}s...`);
            await delay(waitTime);
          } else {
            console.error(`Failed: ${website}`);
            failedWebsites.push(website);
          }
        }
      }

      await page.close();
      await delay(3000 + Math.floor(Math.random() * 3000));

    } catch (error) {
      console.error(`Critical error scraping ${website}: ${error.message}`);
      failedWebsites.push(website);
    }
  }

  return failedWebsites;
}

async function scrapeLinksFromFile() {
  let allWebsites = fs.readFileSync(inputFilePath, 'utf8')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line);

  const outputStream = fs.createWriteStream(outputFilePath, { flags: 'a' });

  const browser = await puppeteer.launch({
    headless: false,
    userDataDir: chromeProfilePath,
    args: ['--no-sandbox']
  });

  let round = 1;

  while (allWebsites.length > 0) {
    console.log(`\nStarting round ${round} with ${allWebsites.length} URLs\n`);

    const failedWebsites = await scrapeLinksFromList(allWebsites, outputStream, browser);

    if (failedWebsites.length === 0) {
      console.log(`All URLs processed successfully after ${round} rounds!`);
      break;
    }

    fs.writeFileSync(failedFilePath, failedWebsites.join('\n'));
    console.log(`${failedWebsites.length} URLs failed in round ${round}, will retry.`);

    allWebsites = failedWebsites;
    round++;
  }

  outputStream.end();
  await browser.close();

  console.log('Scraping completed. Results saved to:', outputFilePath);
  if (fs.existsSync(failedFilePath)) {
    console.log('Failed URLs saved to:', failedFilePath);
  }
}

scrapeLinksFromFile().catch(console.error);
