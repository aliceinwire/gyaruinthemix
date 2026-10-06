// Presentation only: product identities, availability and prices stay authoritative.
const englishProducts = {
  sticker: {
    name: 'Logo sticker',
    description: 'Add a little gyaru attitude to your everyday essentials.',
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
  'バッグを保存できません。ブラウザーの保存設定を確認してください。':
    'Your bag could not be saved. Please check your browser’s storage settings.',
  '決済情報を保存できません。ブラウザーの保存設定を確認してください。':
    'Your checkout details could not be saved. Please check your browser’s storage settings.',
  'テスト決済は完了していますが、保存されたバッグを確認できません。決済情報を保持しています。保存設定を確認して再読み込みしてください。':
    'Test payment is complete, but we could not verify your saved bag. Your checkout details have been kept. Check your browser’s storage settings and reload.',
  'テスト決済は完了していますが、バッグを保存できませんでした。重複を避けるため決済情報を保持しています。保存設定を確認して再読み込みしてください。':
    'Test payment is complete, but your bag could not be saved. Your checkout details have been kept to prevent duplicate payments. Check your browser’s storage settings and reload.',
  'テスト決済の完了を確認し、決済したバッグを空にしました。実際のお支払い・発送はありません。':
    'Test payment was verified and the checked-out bag was cleared. No real payment or shipping takes place.',
  'テスト決済の完了を確認しました。バッグは決済開始後に変更されているため保持しました。支払済みの商品が残っていれば削除してください。':
    'Test payment was verified. Your bag was kept because it changed after checkout began. Remove any items already included in the completed test payment.',
  '決済情報が更新されたため、古い結果を適用しません。':
    'Your checkout details changed, so the older result will not be applied.',
  'テスト決済の状態を確認できませんでした。':
    'We could not verify the test checkout status.',
  '以前のテスト決済は期限切れです。バッグを確認して、もう一度テスト決済へ進んでください。':
    'Your previous test checkout expired. Review your bag and start test checkout again.',
  'テスト決済は確認中です。重複を避けるため、新しい決済は開始しません。時間をおいて再読み込みしてください。':
    'Your test payment is still being confirmed. To prevent duplicates, a new checkout will not be started. Please wait and reload.',
  '以前のテスト決済はこのバッグから自動確認できません。Stripeで結果を確認し、支払済みの商品を削除してから、新しいテスト決済を始めてください。':
    'The previous test checkout cannot be verified automatically from this bag. Check its result in Stripe and remove any items already paid for in testing before starting a new test checkout.',
  '以前のテスト決済の状態を確認できません。Stripeで結果を確認してから、新しいテスト決済を始めてください。':
    'The previous test checkout status could not be verified. Check its result in Stripe before starting a new test checkout.',
  'この戻り先と保存されたテスト決済が一致しないため、バッグを変更しません。テストショップへ戻って確認してください。':
    'This return page does not match your saved test checkout. Your bag has not been changed. Return to the test shop to review it.',
  'テスト決済の状態を確認できませんでした。再読み込みして確認してください。':
    'We could not verify the test checkout status. Please reload to check again.',
  'テスト決済の状態を確認できませんでした。バッグは保持しています。再読み込みして確認してください。':
    'We could not verify the test checkout status. Your bag has been kept. Please reload to check again.',
  '新しいテスト決済を開始できます。支払済みの商品をもう一度含めないよう、バッグを確認してください。':
    'You can start a new test checkout. Review your bag to avoid including items already paid for in testing.',
  '購入できる数量の上限です。': 'You have reached the quantity limit.',
  'バッグはまだ空っぽ。好きなものを見つけてね。':
    'Your bag is empty. Find something you love.',
  現在は購入できません: 'Currently unavailable',
  削除: 'Remove',
  確認中: 'Checking',
  'テスト専用です。実際のお支払い・商品の発送はありません。':
    'For testing only. No real payment or shipping takes place.',
  '送料は販売開始時にご案内します。':
    'Shipping costs will be announced when sales open.',
  '決済ページを準備しています…': 'Preparing checkout…',
  'テスト決済へ進む ↗': 'Continue to test checkout ↗',
  '決済へ進む ↗': 'Continue to checkout ↗',
  'バッグに追加しました ♡': 'Added to your bag ♡',
  価格未定: 'Price to be announced',
  テスト用: 'Test only',
  販売中: 'Available',
  販売準備中: 'Coming soon',
  'バッグに追加 ＋': 'Add to bag ＋',
  売り切れ: 'Sold out',
  準備中: 'Coming soon',
  'テストショップは現在無効です。実際のお支払い・商品の発送はありません。':
    'The test shop is currently disabled. No real payment or shipping takes place.',
  'テストショップです。実際の購入・発送はありません。':
    'This is a test shop. No real purchases or shipping take place.',
  '商品情報を読み込めませんでした。時間をおいてページを再読み込みしてください。':
    'Product information could not be loaded. Please wait and reload the page.',
  '決済ページを開けませんでした。': 'Checkout could not be opened.',
  '以前のテスト決済を再開できません。結果を確認してください。':
    'The previous test checkout could not be resumed. Please check its result.',
  'テスト決済を確認できませんでした。':
    'The test checkout could not be verified.',
  '通信を確認して、もう一度お試しください。':
    'Check your connection and try again.',
  '確認できる決済情報がこのブラウザーに保存されていません。バッグは変更していません。結果はStripe Sandboxで確認してください。':
    'No verifiable checkout details are saved in this browser. Your bag has not been changed. Check the result in Stripe Sandbox.',
};

export function shopText(locale, message) {
  return locale === 'en' ? englishMessages[message] || message : message;
}
