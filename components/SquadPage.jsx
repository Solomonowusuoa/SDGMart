// SquadPage — personalised squad view (one squad per signed-in user).
const SquadPage = ({ setPage, currentUser }) => {
  const isMobile = useMobile();
  const [squad, setSquad] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [copied, setCopied] = React.useState(false);

  // Guests can't have a squad
  const isGuest = !currentUser || currentUser.role === 'guest' || !currentUser.id;

  React.useEffect(() => {
    if (isGuest) { setLoading(false); return; }
    apiFetch(`/api/squads/${currentUser.id}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => setSquad(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [currentUser]);

  if (isGuest) {
    return (
      <div style={{ maxWidth: 540, margin: '60px auto', padding: '0 24px', textAlign: 'center' }}>
        <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-lg)', padding: '40px 32px', boxShadow: 'var(--shadow-lg)' }}>
          <div style={{ fontSize: 48 }}>🤝</div>
          <h1 style={{ fontFamily: 'var(--font-head)', fontSize: 24, fontWeight: 700, marginTop: 12 }}>Squad is for Members</h1>
          <p style={{ fontSize: 14, color: 'var(--warm-gray)', marginTop: 10, lineHeight: 1.6 }}>
            Sign up for a free account to start a squad, invite friends, and unlock GHS 25 credit each when everyone hits GHS 500.
          </p>
          <button onClick={() => { sessionStorage.removeItem('sdgmart_user'); window.location.reload(); }}
            style={{ marginTop: 20, background: 'var(--sage)', color: '#fff', borderRadius: 10, padding: '12px 24px', fontWeight: 700, fontSize: 14 }}>
            Sign Up Now
          </button>
          <button onClick={() => setPage('home')}
            style={{ display: 'block', margin: '14px auto 0', color: 'var(--warm-gray)', fontSize: 13 }}>
            ← Back to Shopping
          </button>
        </div>
      </div>
    );
  }

  if (loading) return (
    <div style={{ textAlign: 'center', padding: '80px 0', color: 'var(--warm-gray)' }}>Loading your squad…</div>
  );
  if (!squad) return (
    <div style={{ textAlign: 'center', padding: '80px 0', color: 'var(--warm-gray)' }}>Could not load squad data.</div>
  );

  const GOAL = squad.goal || 500;
  const referralLink = `${window.location.origin}/?ref=${squad.referralCode}`;
  const me = squad.members.find(m => m.isYou) || { totalSpent: 0, discountPending: false };
  const others = squad.members.filter(m => !m.isYou);
  const myProgress = Math.min(100, ((me.totalSpent || 0) / GOAL) * 100);
  const allMet = squad.members.length > 0 && squad.members.every(m => (m.totalSpent || 0) >= GOAL);
  const discountPending = me.discountPending;

  const copyLink = () => {
    navigator.clipboard.writeText(referralLink).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shareText = `Sign up on SDGMart with my link — I get GHS 5 off, and when our squad each hit GHS 500 we all get GHS 25 credit: ${referralLink}`;
  const shareLink = async () => {
    // Prefer the native share sheet (lets the user pick WhatsApp, SMS, etc.)
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Join my SDGMart Squad',
          text: 'Shop together, save together — GHS 25 each when we all hit GHS 500.',
          url: referralLink,
        });
        return;
      } catch (_) { /* user cancelled — fall through to WhatsApp */ }
    }
    // Fallback: open WhatsApp's "share to any contact" picker
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(shareText)}`, '_blank', 'noopener');
  };

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: isMobile ? '20px 16px' : '32px 24px' }}>
      {/* Hero */}
      <div style={{ background: 'linear-gradient(135deg, var(--sage-dark) 0%, var(--sage) 100%)', borderRadius: 'var(--radius-lg)', padding: isMobile ? '28px 22px' : '36px 32px', color: '#fff', marginBottom: 24, position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', right: -30, top: -30, width: 180, height: 180, borderRadius: '50%', background: 'rgba(255,255,255,.06)' }} />
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.1em', opacity: .8, textTransform: 'uppercase', marginBottom: 8 }}>Group Buying</div>
        <h1 style={{ fontFamily: 'var(--font-head)', fontSize: isMobile ? 26 : 32, fontWeight: 700, marginBottom: 8 }}>{squad.me.name}'s Squad 🤝</h1>
        <p style={{ opacity: .9, fontSize: 14, lineHeight: 1.6, maxWidth: 460 }}>
          When every squad member hits <strong>GHS {GOAL}</strong> in purchases, everyone is credited <strong>GHS 25</strong> (5% of the target) — applied automatically at your next checkout via your loyalty credit. Totals then reset so you can go again.
        </p>
      </div>

      {/* Discount banner */}
      {discountPending && (
        <div style={{ background: 'var(--sage)', color: '#fff', borderRadius: 'var(--radius-lg)', padding: '18px 22px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ fontSize: 28 }}>🎉</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Your legacy 5% squad discount is ready!</div>
            <div style={{ fontSize: 12, opacity: .9, marginTop: 2 }}>It will be applied automatically at your next checkout. (Future squad goals will pay out as GHS 25 loyalty credit instead.)</div>
          </div>
        </div>
      )}

      {/* Your progress */}
      <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-lg)', padding: '24px 28px', boxShadow: 'var(--shadow)', marginBottom: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 13, color: 'var(--warm-gray)', fontWeight: 600, marginBottom: 4 }}>Your Spend Toward Goal</div>
            <div style={{ fontFamily: 'var(--font-head)', fontSize: 30, fontWeight: 700, color: 'var(--warm-black)' }}>
              GHS {Math.min(me.totalSpent || 0, GOAL).toFixed(0)} <span style={{ fontSize: 16, color: 'var(--warm-gray)', fontWeight: 400 }}>/ {GOAL}</span>
            </div>
            {(me.totalSpent || 0) > GOAL && (
              <div style={{ fontSize: 12, color: 'var(--sage-dark)', fontWeight: 600, marginTop: 4 }}>
                +GHS {((me.totalSpent || 0) - GOAL).toFixed(0)} banked — rolls into the next round 🎉
              </div>
            )}
          </div>
          {(me.totalSpent || 0) >= GOAL && <span style={{ fontSize: 22 }}>✅</span>}
        </div>
        <div style={{ background: 'var(--cream-dark)', borderRadius: 30, height: 12, overflow: 'hidden' }}>
          <div style={{ height: '100%', borderRadius: 30, background: 'linear-gradient(90deg, var(--sage-light), var(--sage))', width: `${myProgress}%`, transition: 'width 1s ease' }} />
        </div>
      </div>

      {/* Squad members */}
      <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-lg)', padding: '24px 28px', boxShadow: 'var(--shadow)', marginBottom: 20 }}>
        <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 20, fontWeight: 700, marginBottom: 16 }}>Squad Members ({squad.members.length}/5)</h2>

        {squad.members.length === 1 && (
          <div style={{ background: 'var(--cream)', borderRadius: 10, padding: '14px 16px', fontSize: 13, color: 'var(--warm-gray)', marginBottom: 16, lineHeight: 1.6 }}>
            You're the only one here right now. Share your referral link below to invite friends — when they sign up using your code, they join your squad automatically.
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {squad.members.map((m, i) => {
            const mp = Math.min(100, ((m.totalSpent || 0) / GOAL) * 100);
            return (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ width: 40, height: 40, borderRadius: '50%', background: m.isYou ? 'var(--sage)' : 'var(--cream-dark)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 15, color: m.isYou ? '#fff' : 'var(--warm-gray)', flexShrink: 0 }}>
                  {m.name[0].toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                    <span style={{ fontWeight: 700, fontSize: 14 }}>
                      {m.name} {m.isYou && <span style={{ color: 'var(--sage)', fontSize: 11 }}>(You)</span>}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: (m.totalSpent || 0) >= GOAL ? 'var(--sage-dark)' : 'var(--warm-gray)' }}>
                      GHS {Math.min(m.totalSpent || 0, GOAL).toFixed(0)}{(m.totalSpent || 0) > GOAL ? ` (+${((m.totalSpent || 0) - GOAL).toFixed(0)})` : ''}
                    </span>
                  </div>
                  <div style={{ background: 'var(--cream-dark)', borderRadius: 30, height: 6, overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: 30, background: (m.totalSpent || 0) >= GOAL ? 'var(--sage)' : 'var(--sage-light)', width: `${mp}%`, transition: 'width .8s ease' }} />
                  </div>
                </div>
                {(m.totalSpent || 0) >= GOAL && <span style={{ fontSize: 16, flexShrink: 0 }}>✅</span>}
              </div>
            );
          })}
        </div>
      </div>

      {/* Referral */}
      <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-lg)', padding: '24px 28px', boxShadow: 'var(--shadow)' }}>
        <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 20, fontWeight: 700, marginBottom: 6 }}>Invite Friends → Earn GHS 5 Each</h2>
        <p style={{ fontSize: 13, color: 'var(--warm-gray)', marginBottom: 14, lineHeight: 1.6 }}>
          When a friend signs up with your code <strong style={{ color: 'var(--warm-black)' }}>and makes their first purchase</strong>, you get <strong style={{ color: 'var(--warm-black)' }}>GHS 5 credit</strong>. Credits stack — invite as many as you like.
        </p>
        <p style={{ fontSize: 13, color: 'var(--warm-gray)', marginBottom: 14, lineHeight: 1.6 }}>
          Your code: <strong style={{ color: '#000', letterSpacing: '.06em' }}>{squad.referralCode}</strong>
        </p>
        <div style={{ display: 'flex', gap: 10, flexDirection: isMobile ? 'column' : 'row' }}>
          <input readOnly value={referralLink}
            style={{ flex: 1, padding: '11px 14px', borderRadius: 10, border: '1.5px solid var(--cream-dark)', background: 'var(--cream)', fontSize: 12, color: 'var(--warm-gray)' }} />
          <button onClick={copyLink}
            style={{ background: copied ? 'var(--sage-dark)' : 'var(--sage)', color: '#fff', borderRadius: 10, padding: '11px 20px', fontWeight: 700, fontSize: 13, transition: 'background .2s', whiteSpace: 'nowrap' }}>
            {copied ? '✓ Copied!' : 'Copy Link'}
          </button>
        </div>
        <button onClick={shareLink}
          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 12, background: '#25D366', color: '#fff', borderRadius: 10, padding: '12px', fontWeight: 700, fontSize: 14, border: 'none', cursor: 'pointer' }}>
          📱 Share Referral Link
        </button>
      </div>

      {/* Top recruiters leaderboard */}
      <TopRecruiters />

      <button onClick={() => setPage('home')} style={{ marginTop: 20, color: 'var(--warm-gray)', fontSize: 13, fontWeight: 600 }}>
        ← Back to Shopping
      </button>
    </div>
  );
};

// Public top-recruiters leaderboard (first names only)
const TopRecruiters = () => {
  const [leaders, setLeaders] = React.useState(null);
  React.useEffect(() => {
    fetch('/api/leaderboard').then(r => r.ok ? r.json() : []).then(setLeaders).catch(() => setLeaders([]));
  }, []);
  if (!leaders || leaders.length === 0) return null;
  return (
    <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-lg)', padding: '20px 24px', boxShadow: 'var(--shadow)', marginTop: 20 }}>
      <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 700, marginBottom: 4 }}>🏆 Top Recruiters — This Month</h2>
      <p style={{ fontSize: 12, color: 'var(--warm-gray)', marginBottom: 14 }}>Most friends brought in this month. The leader at month-end wins <strong style={{ color: 'var(--warm-black)' }}>GHS 15 off</strong> their next order. Resets on the 1st!</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {leaders.slice(0, 5).map((u, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderTop: i === 0 ? 'none' : '1px solid var(--cream-dark)' }}>
            <span style={{ width: 24, textAlign: 'center', fontSize: 16 }}>{['🥇','🥈','🥉'][i] || <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--warm-gray)' }}>{i + 1}</span>}</span>
            <span style={{ flex: 1, fontWeight: 600, fontSize: 14 }}>{u.name}</span>
            <span style={{ fontSize: 12, color: 'var(--warm-gray)', fontWeight: 700 }}>{u.referralCount} friend{u.referralCount === 1 ? '' : 's'}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

Object.assign(window, { SquadPage, TopRecruiters });
