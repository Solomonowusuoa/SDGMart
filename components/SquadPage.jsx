// SquadPage — personalised squad view (one squad per signed-in user). (design refresh)
const SquadPage = ({ setPage, currentUser }) => {
  const isMobile = useMobile();
  const [squad, setSquad] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [loadErr, setLoadErr] = React.useState('');
  const [reloadKey, setReloadKey] = React.useState(0);
  const [copied, setCopied] = React.useState(false);
  const isGuest = !currentUser || currentUser.role === 'guest' || !currentUser.id;

  React.useEffect(() => {
    if (isGuest) { setLoading(false); return; }
    setLoading(true);
    // A swallowed failure here rendered as "you have no squad", which is a
    // confident false statement rather than an error the customer can act on.
    apiFetch(`/api/squads/${currentUser.id}`)
      .then(r => { if (!r.ok) throw new Error('load failed'); return r.json(); })
      .then((d) => { setSquad(d); setLoadErr(''); })
      .catch(() => setLoadErr('We could not load your squad just now.'))
      .finally(() => setLoading(false));
  }, [currentUser, reloadKey]);   // reloadKey lets Try again re-run the fetch

  const wrap = { maxWidth: 820, fontFamily: 'var(--f-ui)', color: 'var(--ink)', background: 'var(--panel)', minHeight: '60vh' };
  const label = { fontFamily: 'var(--f-label)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', cursor: 'pointer' };
  const card = { border: '1px solid var(--rule-2)', padding: '24px 28px', marginBottom: 18 };

  if (isGuest) {
    return (
      <div className="rd-gutter" style={{ ...wrap, margin: '0 auto', paddingTop: 60, paddingBottom: 60, maxWidth: 560, textAlign: 'center' }}>
        <div style={{ border: '1px solid var(--rule-2)', padding: '40px 32px' }}>
          <div style={{ fontFamily: 'var(--f-label)', fontSize: 12, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--accent)' }}>Group buying</div>
          <h1 style={{ fontFamily: 'var(--f-display)', fontSize: 28, fontWeight: 700, letterSpacing: '-.028em', marginTop: 8 }}>Squad is for members</h1>
          <p style={{ fontSize: 14, color: 'var(--rd-muted)', marginTop: 10, lineHeight: 1.6 }}>Sign up for a free account to start a squad, invite friends, and unlock GHS 25 credit each — once your squad is 5 strong and everyone has hit GHS 500.</p>
          <button onClick={() => { sessionStorage.removeItem('sdgmart_user'); window.location.reload(); }} style={{ ...label, marginTop: 22, background: 'var(--ink)', color: '#fff', border: 'none', padding: '13px 24px', fontSize: 12.5 }}>Sign up now</button>
          <button onClick={() => setPage('home')} style={{ display: 'block', margin: '16px auto 0', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--rd-muted)', fontSize: 13 }}>← Back to shopping</button>
        </div>
      </div>
    );
  }
  if (loading) return <div style={{ textAlign: 'center', padding: '80px 0', color: 'var(--rd-muted)', fontFamily: 'var(--f-ui)' }}>Loading your squad…</div>;
  if (loadErr) return (
    <div style={{ textAlign: 'center', padding: '80px 24px', fontFamily: 'var(--f-ui)' }}>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>{loadErr}</div>
      <div style={{ fontSize: 13.5, color: 'var(--rd-muted)', marginBottom: 16 }}>
        This is a connection problem, not an empty squad — your progress is safe.
      </div>
      <button onClick={() => { setLoadErr(''); setReloadKey(k => k + 1); }}
        style={{ background: 'var(--ink)', color: '#fff', border: 'none', padding: '11px 22px', fontFamily: 'var(--f-ui)', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
        Try again
      </button>
    </div>
  );
  if (!squad) return <div style={{ textAlign: 'center', padding: '80px 0', color: 'var(--rd-muted)', fontFamily: 'var(--f-ui)' }}>You are not in a squad yet.</div>;

  const GOAL = squad.goal || 500;
  // Mirrors MIN_SQUAD_MEMBERS in database.js — the goal does not pay out below this.
  const MIN_MEMBERS = 5;
  const referralLink = `${window.location.origin}/?ref=${squad.referralCode}`;
  const me = squad.members.find(m => m.isYou) || { totalSpent: 0, discountPending: false };
  const myProgress = Math.min(100, ((me.totalSpent || 0) / GOAL) * 100);
  const discountPending = me.discountPending;

  const copyLink = () => { navigator.clipboard.writeText(referralLink).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  const shareText = `Sign up on SDGMart with my link — I get GHS 5 off, and when our squad each hit GHS 500 we all get GHS 25 credit: ${referralLink}`;
  const shareLink = async () => {
    if (navigator.share) { try { await navigator.share({ title: 'Join my SDGMart Squad', text: 'Shop together, save together — GHS 25 each when we all hit GHS 500.', url: referralLink }); return; } catch (_) {} }
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(shareText)}`, '_blank', 'noopener');
  };

  const bigNum = (n, sz) => (
    <span style={{ display: 'inline-flex', alignItems: 'flex-start', gap: 4, fontFamily: 'var(--f-display)', color: 'var(--ink)' }}>
      <span style={{ fontSize: sz * 0.3, fontWeight: 500, color: 'var(--rd-muted)', paddingTop: sz * 0.22 }}>GHS</span>
      <span style={{ fontSize: sz, fontWeight: 800, letterSpacing: '-.03em', lineHeight: 0.9 }}>{n}</span>
    </span>
  );

  return (
    <div className="rd-gutter" style={{ ...wrap, margin: '0 auto', paddingTop: isMobile ? 20 : 32, paddingBottom: 40 }}>
      {/* Header panel */}
      <div style={{ background: 'var(--ink)', color: '#fff', padding: isMobile ? '28px 22px' : '36px 32px', marginBottom: 18 }}>
        <div style={{ fontFamily: 'var(--f-label)', fontSize: 12, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--accent-light)' }}>Group buying</div>
        <h1 style={{ margin: '8px 0 10px', fontFamily: 'var(--f-display)', fontSize: isMobile ? 32 : 46, fontWeight: 800, letterSpacing: '-.03em' }}>{squad.me.name}'s Squad</h1>
        <p style={{ margin: 0, color: 'var(--dark-body)', fontSize: 14, lineHeight: 1.6, maxWidth: 480 }}>Once your squad has <strong style={{ color: '#fff' }}>{MIN_MEMBERS} members</strong> and every one of them has hit <strong style={{ color: '#fff' }}>GHS {GOAL}</strong> in purchases, everyone is credited <strong style={{ color: '#fff' }}>GHS 25</strong>. Anything you spend above the goal rolls into the next round, so nothing is wasted while you wait for the others.</p>
      </div>

      {discountPending && (
        <div style={{ border: '1px solid var(--rule-2)', borderLeft: '2px solid var(--accent)', background: 'var(--surface-warm)', padding: '16px 20px', marginBottom: 18 }}>
          <div style={{ fontFamily: 'var(--f-display)', fontWeight: 700, fontSize: 15 }}>Your legacy 5% squad discount is ready.</div>
          <div style={{ fontSize: 12.5, color: 'var(--rd-body)', marginTop: 3 }}>It will be applied automatically at your next checkout. (Future squad goals pay out as GHS 25 loyalty credit.)</div>
        </div>
      )}

      {/* Your progress */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
          <div>
            <div style={{ fontFamily: 'var(--f-label)', fontSize: 12, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--rd-muted)', marginBottom: 8 }}>Your spend toward goal</div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
              {bigNum(Math.min(me.totalSpent || 0, GOAL).toFixed(0), 46)}
              <span style={{ fontFamily: 'var(--f-display)', fontSize: 20, fontWeight: 700, color: 'var(--rd-faint)', paddingBottom: 4 }}>/ {GOAL}</span>
            </div>
            {(me.totalSpent || 0) > GOAL && <div style={{ fontSize: 12.5, color: 'var(--rd-body)', marginTop: 6 }}>+GHS {((me.totalSpent || 0) - GOAL).toFixed(0)} banked — rolls into the next round.</div>}
          </div>
          {(me.totalSpent || 0) >= GOAL && <span style={{ fontFamily: 'var(--f-label)', fontSize: 12, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--wa)' }}>Goal reached</span>}
        </div>
        <div style={{ background: 'var(--rule)', height: 8, overflow: 'hidden' }}>
          <div style={{ height: '100%', background: 'var(--ink)', width: `${myProgress}%`, transition: 'width 1s ease' }} />
        </div>
      </div>

      {/* Members */}
      <div style={card}>
        <h2 style={{ margin: '0 0 16px', fontFamily: 'var(--f-display)', fontSize: 20, fontWeight: 700, letterSpacing: '-.02em' }}>Squad members ({squad.members.length})</h2>
        {squad.members.length === 1 && (
          <div style={{ background: 'var(--surface-warm)', border: '1px solid var(--rule-2)', padding: '14px 16px', fontSize: 13, color: 'var(--rd-body)', marginBottom: 16, lineHeight: 1.6 }}>You're the only one here right now. A squad needs {MIN_MEMBERS} members before the GHS 25 credit unlocks — share your referral link below, and friends who sign up with your code join automatically. Your spending still counts the whole time.</div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {squad.members.map(m => {
            const mp = Math.min(100, ((m.totalSpent || 0) / GOAL) * 100);
            const met = (m.totalSpent || 0) >= GOAL;
            return (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ width: 34, height: 34, flexShrink: 0, background: m.isYou ? 'var(--ink)' : 'var(--rule-2)', color: m.isYou ? '#fff' : 'var(--rd-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--f-display)', fontWeight: 700, fontSize: 15 }}>{m.name[0].toUpperCase()}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{m.name} {m.isYou && <span style={{ color: 'var(--accent)', fontSize: 11, fontFamily: 'var(--f-mono)', textTransform: 'uppercase' }}>you</span>}</span>
                    <span style={{ fontFamily: 'var(--f-display)', fontSize: 14, fontWeight: 800, color: met ? 'var(--ink)' : 'var(--rd-muted)' }}>GHS {Math.min(m.totalSpent || 0, GOAL).toFixed(0)}{(m.totalSpent || 0) > GOAL ? ` (+${((m.totalSpent || 0) - GOAL).toFixed(0)})` : ''}</span>
                  </div>
                  <div style={{ background: 'var(--rule)', height: 5, overflow: 'hidden' }}>
                    <div style={{ height: '100%', background: met ? 'var(--ink)' : 'var(--accent)', width: `${mp}%`, transition: 'width .8s ease' }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Invite */}
      <div style={card}>
        <h2 style={{ margin: 0, fontFamily: 'var(--f-mark)', fontSize: 20, fontWeight: 700, letterSpacing: '-.02em' }}>Invite friends, <span style={{ fontFamily: 'var(--f-serif)', fontStyle: 'italic', fontWeight: 400, color: 'var(--accent)' }}>earn GHS 5 each</span></h2>
        <p style={{ fontSize: 13, color: 'var(--rd-body)', margin: '10px 0 6px', lineHeight: 1.6 }}>When a friend signs up with your code <strong style={{ color: 'var(--ink)' }}>and makes their first purchase of at least GHS 50</strong>, you get <strong style={{ color: 'var(--ink)' }}>GHS 5 credit</strong>. Credits stack — invite as many as you like.</p>
        <p style={{ fontSize: 13, color: 'var(--rd-muted)', margin: '0 0 14px' }}>Your code: <strong style={{ fontFamily: 'var(--f-mono)', color: 'var(--ink)', letterSpacing: '.06em' }}>{squad.referralCode}</strong></p>
        <div style={{ display: 'flex', gap: 10, flexDirection: isMobile ? 'column' : 'row' }}>
          <input readOnly value={referralLink} style={{ flex: 1, minWidth: 0, padding: '11px 14px', border: '1px solid var(--border-input)', background: 'var(--surface-warm)', fontFamily: 'var(--f-mono)', fontSize: 12, color: 'var(--rd-muted)', outline: 'none' }} />
          <button onClick={copyLink} style={{ ...label, background: 'var(--ink)', color: '#fff', border: 'none', padding: '11px 20px', fontSize: 12.5, whiteSpace: 'nowrap' }}>{copied ? 'Copied ✓' : 'Copy link'}</button>
        </div>
        <button onClick={shareLink} style={{ ...label, width: '100%', marginTop: 12, background: 'var(--wa)', color: '#fff', border: 'none', padding: '13px', fontSize: 13 }}>Share referral link on WhatsApp</button>
      </div>

      <TopRecruiters />
      <button onClick={() => setPage('home')} style={{ marginTop: 20, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--rd-muted)', fontSize: 13 }}>← Back to shopping</button>
    </div>
  );
};

// Public top-recruiters leaderboard (first names only)
const TopRecruiters = () => {
  const [leaders, setLeaders] = React.useState(null);
  React.useEffect(() => { fetch('/api/leaderboard').then(r => r.ok ? r.json() : []).then(setLeaders).catch(() => setLeaders([])); }, []);
  if (!leaders || leaders.length === 0) return null;
  return (
    <div style={{ border: '1px solid var(--rule-2)', padding: '20px 24px', marginTop: 2 }}>
      <h2 style={{ margin: 0, fontFamily: 'var(--f-display)', fontSize: 18, fontWeight: 700, letterSpacing: '-.02em' }}>Top recruiters — this month</h2>
      <p style={{ fontSize: 12.5, color: 'var(--rd-muted)', margin: '4px 0 14px' }}>Most friends brought in this month. The leader at month-end wins <strong style={{ color: 'var(--ink)' }}>GHS 15 off</strong> their next order. Resets on the 1st.</p>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {leaders.slice(0, 5).map((u, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: i === 0 ? 'none' : '1px solid var(--rule)' }}>
            <span style={{ width: 24, fontFamily: 'var(--f-mono)', fontSize: 12, fontWeight: 500, color: i === 0 ? 'var(--accent)' : 'var(--rd-faint)' }}>{String(i + 1).padStart(2, '0')}</span>
            <span style={{ flex: 1, fontWeight: 600, fontSize: 14 }}>{u.name}</span>
            <span style={{ fontFamily: 'var(--f-mono)', fontSize: 12, color: 'var(--rd-muted)' }}>{u.referralCount} friend{u.referralCount === 1 ? '' : 's'}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

Object.assign(window, { SquadPage, TopRecruiters });
