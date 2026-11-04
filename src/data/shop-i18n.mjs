// Presentation only: product identities, availability and prices stay authoritative.
const englishProducts = {
  sticker: {
    name: 'Logo sticker',
    description: 'Add a little gyaru attitude to your everyday essentials.',
    size: 'Backing sheet: W76 × H31 mm',
    imageAlt: 'Gyaru in the Mix logo design',
    imageLabel: 'Logo design reference',
  },
  towel: {
    name: 'Face towel',
    description:
      'On the dance floor or out and about. Bring the energy with us.',
    imageAlt: 'Artwork combining a photo of the duo with their logo',
    imageLabel: 'Artwork reference',
  },
  keychain: {
    name: 'Acrylic keychain',
    description: 'Clip it to your bag and take your gyaru spirit everywhere.',
    size: '50 × 70 mm',
    imageAlt: 'Gyaru in the Mix logo design',
    imageLabel: 'Logo design reference',
  },
  tshirt: {
    name: 'T-shirt',
    description: 'A Gyaru in the Mix T-shirt.',
    imageAlt: 'Gyaru in the Mix logo design',
    imageLabel: 'Logo design reference (not a product photo)',
  },
};

export function localizeProduct(product, locale = 'ja') {
  return locale === 'en' && englishProducts[product.slug]
    ? { ...product, ...englishProducts[product.slug] }
    : product;
}

const englishMessages = {
  '購入できる数量の上限です。': 'You have reached the quantity limit.',
  'バッグはまだ空っぽ。好きなものを見つけてね。':
    'Your bag is empty. Find something you love.',
  現在は購入できません: 'Currently unavailable',
  削除: 'Remove',
  確認中: 'Checking',
  '送料は販売開始時にご案内します。':
    'Shipping costs will be announced when sales open.',
  '決済ページを準備しています…': 'Preparing checkout…',
  '決済へ進む ↗': 'Continue to checkout ↗',
  'バッグに追加しました ♡': 'Added to your bag ♡',
  価格未定: 'Price to be announced',
  販売中: 'Available',
  販売準備中: 'Coming soon',
  'バッグに追加 ＋': 'Add to bag ＋',
  売り切れ: 'Sold out',
  準備中: 'Coming soon',
  'テストショップです。実際の購入・発送はありません。':
    'This is a test shop. No real purchases or shipping take place.',
  '商品情報を読み込めませんでした。時間をおいてページを再読み込みしてください。':
    'Product information could not be loaded. Please wait and reload the page.',
  '決済ページを開けませんでした。': 'Checkout could not be opened.',
  '通信を確認して、もう一度お試しください。':
    'Check your connection and try again.',
};

export function shopText(locale, message) {
  return locale === 'en' ? englishMessages[message] || message : message;
}
