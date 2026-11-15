/** Permanent garage modules, unlocked before departure with gyaru points. */
export const FAMILIES = Object.freeze([
  Object.freeze({ id: 'relay', name: 'ハート連鎖', color: '#ff72bd', description: '貫通から連鎖へ。街の人波を味方にするで。' }),
  Object.freeze({ id: 'guardian', name: '充電ガード', color: '#77f4e8', description: 'EVで守りを仕込んで、次の一発につなぐで。' }),
  Object.freeze({ id: 'air', name: '空中ラッシュ', color: '#ffe091', description: '浮いてよけて、ラッシュで道を開こ。' }),
]);
const data = [
  { id: 'heart-pierce', family: 'relay', tier: 1, name: 'つらぬきハート', description: 'ハートがさらに1か所まで貫通するで。スタイルや得意技の貫通にも足せるで。', preview: 'ハートの貫通数+1', effects: { heartPierce: 1 } },
  { id: 'heart-chain', family: 'relay', tier: 2, name: 'となりもリレー', description: 'ハートが届いた場所から32m以内の1か所へ連鎖や。コーラスハートと組むと38m以内の2か所へ。', preview: '連鎖+1 / コーラス併用で2連鎖・38m', effects: { heartChain: 1, heartChainRange: 32 } },
  { id: 'heart-recycle', family: 'relay', tier: 3, name: 'ときめき還元', description: '招待やシグナル復旧で電池+3や。ときめきリチャージと合わせたら+6や。', preview: 'ハートが届くたび電池+3 / 得意技と合算', effects: { conversionEnergy: 3 } },
  { id: 'charge-shield', family: 'guardian', tier: 1, name: 'EVおまもり', description: 'EVで2秒充電したら、次の衝突1回をガードや。すでにガードがあれば充電時間を0.25秒短縮。', preview: 'EV充電2秒でガード / 併用はさらに−0.25秒', effects: { chargeShield: true, chargeShieldSeconds: 2 } },
  { id: 'charged-heart', family: 'guardian', tier: 2, name: '満タンの一撃', description: '満充電で次に届く一撃の威力+1。自動武器のどれでも使えて、満タンアンプと合わせたら+2や。', preview: '満充電後、次に届く一撃は威力+1 / アンプ併用で+2', effects: { chargedHeartBonus: 1 } },
  { id: 'shield-piercing', family: 'guardian', tier: 3, name: 'おまもり貫通', description: 'EVガードを持ってる間は敵のガードを無視して、ハートがさらに1体貫通や。EVおまもりと一緒に積んで、守りを残そ。', preview: 'EVガード保持中、敵のガードを無視・貫通+1', effects: { shieldPiercing: true } },
  { id: 'air-control', family: 'air', tier: 1, name: 'ふわっと着地', description: '落ちる速さを35%抑えて、スラスター消費も15%節約や。高く飛ぶほど着地を見よ。', preview: '下降速度×0.65 / スラスター消費×0.85', effects: { descentMultiplier: .65, thrustDrainMultiplier: .85 } },
  { id: 'rush-pulse', family: 'air', tier: 2, name: 'ラッシュ開花', description: 'ラッシュ開始で前45mに威力2のハート波。ベースドロップと組むと前75mに広がるで。', preview: '前45mへハート波 / ドロップ併用で75m', effects: { rushPulse: 45 } },
  { id: 'combo-flight', family: 'air', tier: 3, name: '飛びこえチャージ', description: '障害物を空中でよけたら電池+4や。スタイルや得意技と合算、1回につき最大+8。', preview: '空中回避で電池+4 / 合算で最大+8', effects: { comboFlight: 4 } },
];
export const RUN_MOD_CATALOG = Object.freeze(data.map(item => Object.freeze({
  ...item, rarity: ['basic', 'uncommon', 'rare'][item.tier - 1],
  rarityLabel: ['ベーシック', '連携', 'レア'][item.tier - 1], basePrice: item.tier,
  requires: item.tier === 1 ? null : data.find(other => other.family === item.family && other.tier === item.tier - 1).id,
  effects: Object.freeze({ ...item.effects }),
})));
