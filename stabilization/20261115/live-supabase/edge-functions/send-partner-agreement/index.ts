import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { email, fullName, initials, signedAt, answers, agreementId } = await req.json();
    
    if (!email || !fullName) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    const RESEND_KEY = Deno.env.get('RESEND_API_KEY');
    if (!RESEND_KEY) {
      return new Response(JSON.stringify({ error: 'Email service not configured' }), { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    // Build agreement rows
    const rows = (answers || []).map((ans: any, i: number) => {
      if (!ans || !ans.title) return '';
      const status = ans.choice === 'yes' ? '✓ Agreed' : ans.choice === 'no' ? '✕ Declined' : ans.choice === 'adjust' ? '~ Needs Adjustment' : '–';
      const color = ans.choice === 'yes' ? '#1a6b3c' : ans.choice === 'no' ? '#8b1a1a' : '#1a3a6b';
      return `
        <tr>
          <td style="padding:12px 16px;border-bottom:1px solid #E8E0D0;font-weight:600;color:#1a1a1a;font-size:14px;">${ans.title}</td>
          <td style="padding:12px 16px;border-bottom:1px solid #E8E0D0;color:${color};font-weight:700;font-size:14px;">${status}</td>
          <td style="padding:12px 16px;border-bottom:1px solid #E8E0D0;color:#888;font-style:italic;font-size:13px;">${ans.note || ''}</td>
          <td style="padding:12px 16px;border-bottom:1px solid #E8E0D0;font-family:Georgia,serif;color:#B8860B;font-weight:700;font-size:16px;">${ans.initials || ''}</td>
        </tr>`;
    }).join('');

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Partnership Agreement — Buffalo Deal Depot</title></head>
<body style="margin:0;padding:0;background:#F5F0E8;font-family:Georgia,serif;">
  <div style="max-width:680px;margin:40px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.1);">
    
    <!-- Header -->
    <div style="background:linear-gradient(135deg,#1a1208,#2a1e08);padding:40px 40px 32px;">
      <div style="font-size:11px;letter-spacing:0.2em;color:#D4A017;margin-bottom:12px;">BUFFALO DEAL DEPOT</div>
      <h1 style="margin:0;font-size:28px;color:#F5F0E8;letter-spacing:-0.02em;line-height:1.2;">Partnership Agreement</h1>
      <div style="margin-top:12px;font-size:13px;color:#8B7D5E;">Signed: ${signedAt}</div>
    </div>

    <!-- Gold bar -->
    <div style="height:3px;background:linear-gradient(90deg,#B8860B,#FFE066,#B8860B);"></div>

    <!-- Intro -->
    <div style="padding:32px 40px 24px;">
      <p style="margin:0;font-size:15px;color:#2a2a2a;line-height:1.7;">This document confirms that <strong style="color:#B8860B;">${fullName}</strong> has reviewed and responded to all terms presented in the Buffalo Deal Depot Partner Portal.</p>
    </div>

    <!-- Table -->
    <div style="padding:0 40px 32px;">
      <table style="width:100%;border-collapse:collapse;border:1px solid #E8E0D0;border-radius:8px;overflow:hidden;">
        <thead>
          <tr style="background:#F9F5EB;">
            <th style="padding:12px 16px;text-align:left;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#8B7D5E;font-family:sans-serif;border-bottom:2px solid #D4A017;">Term</th>
            <th style="padding:12px 16px;text-align:left;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#8B7D5E;font-family:sans-serif;border-bottom:2px solid #D4A017;">Decision</th>
            <th style="padding:12px 16px;text-align:left;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#8B7D5E;font-family:sans-serif;border-bottom:2px solid #D4A017;">Notes</th>
            <th style="padding:12px 16px;text-align:left;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#8B7D5E;font-family:sans-serif;border-bottom:2px solid #D4A017;">Initials</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>

    <!-- Signature block -->
    <div style="padding:0 40px 40px;">
      <div style="border:1px solid #E8E0D0;border-radius:8px;padding:24px;background:#FDFAF4;">
        <div style="display:flex;gap:40px;align-items:flex-start;">
          <div style="flex:1;">
            <div style="font-size:10px;letter-spacing:0.12em;color:#8B7D5E;margin-bottom:8px;font-family:sans-serif;">SIGNED BY</div>
            <div style="font-size:20px;font-weight:700;color:#1a1a1a;">${fullName}</div>
            <div style="font-size:12px;color:#8B7D5E;margin-top:4px;font-family:sans-serif;">${signedAt}</div>
          </div>
          <div>
            <div style="font-size:10px;letter-spacing:0.12em;color:#8B7D5E;margin-bottom:8px;font-family:sans-serif;">INITIALS</div>
            <div style="font-size:32px;color:#B8860B;font-weight:700;letter-spacing:0.1em;">${initials}</div>
          </div>
        </div>
        ${agreementId ? `<div style="margin-top:16px;padding-top:16px;border-top:1px solid #E8E0D0;font-size:10px;color:#aaa;font-family:monospace;">Agreement ID: ${agreementId}</div>` : ''}
      </div>
    </div>

    <!-- Footer -->
    <div style="background:#1a1208;padding:24px 40px;">
      <p style="margin:0;font-size:11px;color:#4A3F28;line-height:1.6;font-family:sans-serif;">This document was generated digitally via the Buffalo Deal Depot Partner Portal. By signing, the party acknowledges having reviewed and accepted the terms as presented. This serves as a binding record of agreement. Buffalo Deal Depot &copy; ${new Date().getFullYear()}.</p>
    </div>
  </div>
</body>
</html>`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Buffalo Deal Depot <agreements@buffalodealdepot.com>',
        to: [email],
        bcc: ['moebouka@gmail.com'],
        subject: `Partnership Agreement — ${fullName} — ${new Date().toLocaleDateString()}`,
        html,
      })
    });

    const result = await res.json();
    
    if (!res.ok) {
      console.error('Resend error:', result);
      return new Response(JSON.stringify({ error: 'Failed to send email', detail: result }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ success: true, id: result.id }), { headers: { ...CORS, 'Content-Type': 'application/json' } });

  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
});
