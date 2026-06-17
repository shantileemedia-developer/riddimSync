const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.type(), msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.toString()));
  
  await page.goto('https://studiolink-vert.vercel.app/');
  
  await page.type('input[type="email"]', 'shantelbridget93@gmail.com');
  await page.type('input[type="password"]', 'Admin101!');
  await page.click('button[type="submit"]');
  
  await new Promise(r => setTimeout(r, 3000));
  
  try {
    await page.type('.session-input', '123456');
    await new Promise(r => setTimeout(r, 500));
    await page.click('.session-btn.primary');
  } catch (e) {}
  
  await new Promise(r => setTimeout(r, 3000));
  
  console.log('Changing volume properly...');
  await page.evaluate(() => {
    const input = document.querySelector('.track-volume-slider');
    if (input) {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeInputValueSetter.call(input, 0.5);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      console.log('No track volume slider found!');
    }
  });
  
  await new Promise(r => setTimeout(r, 2000));
  
  await browser.close();
})();
