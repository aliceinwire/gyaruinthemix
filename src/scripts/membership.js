const panel = document.querySelector('[data-membership]');
if (panel) {
  const en = panel.dataset.locale === 'en';
  const t = (ja, english) => (en ? english : ja);
  const el = (name) => panel.querySelector(`[data-${name}]`);
  const status = el('membership-status');
  const join = el('member-join');
  const login = el('member-login');
  const feed = el('member-feed');
  const attemptKey = 'gyaru-membership-attempt-v1';
  let plan;
  let account;
  let termsReady = false;
  let checkoutBusy = false;
  function updateJoin() {
    join.disabled =
      checkoutBusy ||
      !termsReady ||
      !plan?.enabled ||
      !account?.authenticated ||
      account.member;
  }
  let generation = 0;
  function clearPrivate() {
    generation++;
    termsReady = false;
    plan = null;
    account = null;
    updateJoin();
    feed.replaceChildren();
    feed.hidden = true;
  }
  let token = new URLSearchParams(location.hash.slice(1)).get('login');
  if (token)
    history.replaceState(null, '', `${location.pathname}${location.search}`);
  const request = async (path, body, headers = {}) => {
    const response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        'X-Shop-Locale': en ? 'en' : 'ja',
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw Object.assign(new Error('Request unavailable'), {
        code: errorBody.code,
      });
    }
    return response.json();
  };
  const unavailable = () => {
    status.textContent = t(
      '現在確認できません。少し待って再読み込みしてください。',
      'We cannot verify this right now. Please wait and reload.',
    );
  };
  function savedAttempt() {
    try {
      return JSON.parse(sessionStorage.getItem(attemptKey));
    } catch {
      return null;
    }
  }
  function clearAttempt() {
    try {
      sessionStorage.removeItem(attemptKey);
    } catch {
      /* Storage may be blocked. */
    }
  }
  function renderFeed(posts) {
    feed.replaceChildren();
    for (const post of posts) {
      const article = document.createElement('article');
      const title = document.createElement('h3');
      title.textContent = post.title;
      const date = document.createElement('p');
      date.textContent = post.publishedAt;
      const body = document.createElement('p');
      body.className = 'member-post-body';
      body.textContent = post.body;
      article.append(title, date, body);
      for (const asset of post.assets || []) {
        const url = new URL(asset.url, location.origin);
        if (
          url.origin !== location.origin ||
          !url.pathname.startsWith('/api/member/')
        )
          continue;
        const img = document.createElement('img');
        img.src = url.href;
        img.alt = asset.alt || '';
        img.loading = 'lazy';
        article.append(img);
      }
      feed.append(article);
    }
    if (!posts.length) {
      const empty = document.createElement('p');
      empty.textContent = t(
        '限定コンテンツは準備中です。',
        'Members-only content is being prepared.',
      );
      feed.append(empty);
    }
    feed.hidden = false;
  }
  async function refresh() {
    clearPrivate();
    const currentGeneration = generation;
    join.disabled = true;
    const latestPlan = await request('/api/membership/plan');
    let latestAccount;
    try {
      latestAccount = await request('/api/member/session');
    } catch (error) {
      if (latestPlan.enabled) throw error;
      latestAccount = { authenticated: false, member: false, available: false };
    }
    if (currentGeneration !== generation) return;
    plan = latestPlan;
    account = latestAccount;
    login.hidden =
      account.available === false || account.authenticated || !!token;
    el('member-verify').hidden = !token;
    el('member-account').hidden = !account.authenticated;
    el('member-email').textContent = account.email || '';
    el('member-plan').hidden = !plan.enabled;
    if (plan.enabled) {
      const pending = savedAttempt();
      const shownPlan = pending?.plan || plan.plan;
      const amount = new Intl.NumberFormat(en ? 'en-JP' : 'ja-JP', {
        style: 'currency',
        currency: 'JPY',
        maximumFractionDigits: 0,
      }).format(shownPlan.amount);
      el('member-price').textContent =
        t(`月額 ${amount}`, `${amount} / month`) +
        (shownPlan.taxBehavior === 'inclusive'
          ? t('（税込）', ' (tax included)')
          : t(
              '（税額は決済画面でご確認ください）',
              ' (review taxes at checkout)',
            ));
      if (pending) {
        el('member-price').textContent = pending.plan
          ? t('再開する決済の会費：', 'Saved checkout fee: ') +
            el('member-price').textContent
          : t(
              '保存済みの決済を再開します。選択済みの月額会費をStripeでご確認ください。',
              'Resume your saved checkout. Review its originally selected monthly fee on Stripe.',
            );
      }
      join.textContent = pending
        ? t('保存済みの決済を再開', 'Resume saved checkout')
        : t('月額会員として入会する', 'Subscribe monthly');
      termsReady = true;
      updateJoin();
    }
    const portal = el('member-portal');
    portal.hidden = true;
    if (plan.portalUrl) {
      const url = new URL(plan.portalUrl);
      if (
        url.origin === 'https://billing.stripe.com' &&
        /^\/p\/login\//.test(url.pathname)
      ) {
        portal.href = url.href;
        portal.hidden = false;
      }
    }
    if (account.member) {
      clearAttempt();
      status.textContent = t(
        '会員としてログインしています。',
        'You are signed in as a member.',
      );
      const content = await request('/api/member/posts');
      if (currentGeneration !== generation) return;
      renderFeed(content.posts);
    } else if (account.available === false) {
      status.textContent = t(
        '入会受付・ログインの準備中です。',
        'Membership registration and sign-in are being prepared.',
      );
    } else if (token)
      status.textContent = t(
        '下のボタンでログインを確認してください。',
        'Confirm your sign-in using the button below.',
      );
    else if (!plan.enabled)
      status.textContent = t(
        '新規入会は準備中です。既存の会員の方はログインできます。',
        'New subscriptions are not open yet. Existing members can sign in.',
      );
    else if (account.authenticated)
      status.textContent = t(
        '限定コンテンツの閲覧には月額会員登録が必要です。決済直後は少し待って再読み込みしてください。',
        'Subscribe monthly to access private content. If you just paid, wait a moment and reload.',
      );
    else
      status.textContent = t(
        'まずメールでログインしてください。',
        'Sign in by email to get started.',
      );
  }
  login.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = login.querySelector('button');
    button.disabled = true;
    try {
      await request('/api/member/login/request', {
        email: new FormData(login).get('email'),
        locale: en ? 'en' : 'ja',
      });
      status.textContent = t(
        '送信できる場合はログインリンクをお送りします。メールをご確認ください。',
        'If sign-in is available, a link will arrive by email. Please check your inbox.',
      );
    } catch {
      unavailable();
    } finally {
      button.disabled = false;
    }
  });
  el('member-verify').addEventListener('click', async () => {
    const button = el('member-verify');
    button.disabled = true;
    try {
      await request('/api/member/login/redeem', { token });
      token = null;
      clearAttempt();
      await refresh();
    } catch {
      status.textContent = t(
        'ログインを確認できません。このブラウザで新しいリンクをリクエストしてください。',
        'Sign-in could not be verified. Request a fresh link in this browser.',
      );
      token = null;
      login.hidden = false;
    } finally {
      button.disabled = false;
    }
  });
  el('member-logout').addEventListener('click', async () => {
    clearPrivate();
    try {
      await request('/api/member/logout', {});
      clearAttempt();
      feed.replaceChildren();
      await refresh();
    } catch {
      unavailable();
    }
  });
  join.addEventListener('click', async () => {
    if (
      !termsReady ||
      !plan?.enabled ||
      !account?.authenticated ||
      account.member ||
      checkoutBusy
    )
      return;
    checkoutBusy = true;
    updateJoin();
    try {
      let attempt;
      try {
        attempt = JSON.parse(sessionStorage.getItem(attemptKey));
      } catch {
        /* New attempt below. */
      }
      if (!attempt) {
        attempt = {
          id: crypto.randomUUID(),
          version: plan.version,
          plan: plan.plan,
          locale: en ? 'en' : 'ja',
        };
        sessionStorage.setItem(attemptKey, JSON.stringify(attempt));
      }
      const result = await request(
        '/api/membership/checkout',
        { planVersion: attempt.version, locale: attempt.locale },
        { 'Idempotency-Key': attempt.id },
      );
      if (result.status === 'open' && result.url) {
        const url = new URL(result.url);
        if (url.origin !== 'https://checkout.stripe.com')
          throw new Error('Invalid checkout');
        location.assign(url.href);
      } else if (result.status === 'expired') {
        clearAttempt();
        await refresh();
        status.textContent = t(
          '決済ページの期限が切れました。最新の会費をご確認のうえ、もう一度お試しください。',
          'Your checkout expired. Review the current monthly fee before trying again.',
        );
      } else {
        status.textContent = t(
          '決済状況を確認中です。少し待って再読み込みしてください。',
          'Your payment is being verified. Wait a moment and reload.',
        );
      }
    } catch (error) {
      if (error.code === 'MEMBERSHIP_PLAN_CHANGED') {
        clearAttempt();
        try {
          await refresh();
        } catch {
          unavailable();
          return;
        }
        status.textContent = t(
          '会費が更新されました。表示内容をご確認のうえ、改めて入会ボタンを押してください。',
          'The monthly fee changed. Review the updated terms, then click subscribe again.',
        );
      } else if (error.code === 'MEMBERSHIP_ALREADY_SUBSCRIBED') {
        try {
          await refresh();
        } catch {
          unavailable();
          return;
        }
        status.textContent = t(
          '契約が既にあります。Stripeでお支払い状況をご確認ください。',
          'You already have a subscription. Check your billing status on Stripe.',
        );
      } else {
        unavailable();
      }
    } finally {
      checkoutBusy = false;
      updateJoin();
    }
  });
  window.addEventListener('pagehide', clearPrivate);
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) refresh().catch(unavailable);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') clearPrivate();
    else refresh().catch(unavailable);
  });
  refresh().catch(unavailable);
}
