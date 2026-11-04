import assert from 'node:assert/strict';

export async function checkProductDetails(page, { en, staticStock }) {
  for (const [slug, sizeJa, sizeEn, stock, price] of [
    [
      'sticker',
      '台紙 ヨコ76×タテ31mm',
      'Backing sheet: W76 × H31 mm',
      50,
      '¥500',
    ],
    ['keychain', '50×70mm', '50 × 70 mm', 9, '¥1,500'],
  ]) {
    const card = page.locator(`.product-${slug}`);
    const details = card.locator('.product-details');
    const size = details.locator('div').filter({
      has: page.getByText(en ? 'Size' : 'サイズ', { exact: true }),
    });
    assert.equal(await size.locator('dd').textContent(), en ? sizeEn : sizeJa);
    const stockRow = details.locator('div').filter({
      has: page.getByText(en ? 'Stock' : '在庫', { exact: true }),
    });
    if (staticStock) {
      assert.equal(
        await stockRow.locator('dd').textContent(),
        en ? `${stock} units` : `${stock}個`,
      );
      assert.equal(
        (await card.locator('[data-price]').textContent()).trim(),
        price,
      );
    } else {
      assert.equal(await stockRow.count(), 0);
    }
    const gallery = await card.locator('[data-product-gallery]').boundingBox();
    const description = await details.boundingBox();
    const purchase = await card.locator('.product-buy').boundingBox();
    assert.ok(description.y >= gallery.y + gallery.height - 1);
    assert.ok(description.y + description.height <= purchase.y + 1);
  }
}
