// Serves /api/discord-feed: latest announcements + loot screenshots from the RAD Discord.
// Secrets live only in Netlify environment variables:
//   DISCORD_BOT_TOKEN            read-only bot in the RAD server
//   DISCORD_ANNOUNCE_CHANNEL_ID  e.g. #announcements
//   DISCORD_GALLERY_CHANNEL_ID   e.g. #loot-and-clogs
// Only message text, image links, display names and dates are passed to visitors.

const API = "https://discord.com/api/v10";
const GUILD = Netlify.env.get("DISCORD_GUILD_ID") || "1531770729576665158";
const IMG = /\.(png|jpe?g|gif|webp)(\?|$)/i;

type Att = { url: string; content_type?: string; filename?: string; width?: number; height?: number };
type Emb = { title?: string; description?: string; image?: { url?: string }; thumbnail?: { url?: string }; author?: { name?: string } };
type Msg = { id: string; webhook_id?: string; content: string; timestamp: string; author: { username: string; global_name?: string | null; bot?: boolean };
             attachments?: Att[]; embeds?: Emb[]; member?: { nick?: string | null } };

async function messages(channel: string, token: string): Promise<Msg[]> {
  const res = await fetch(`${API}/channels/${channel}/messages?limit=50`, { headers: { Authorization: `Bot ${token}` } });
  if (!res.ok) throw new Error(`discord ${res.status}`);
  return res.json();
}

// Strip Discord-only markup (user/role/channel mentions, custom emoji) so it reads cleanly on the site.
const clean = (s = "") => s
  .replace(/<a?:(\w+):\d+>/g, "")
  .replace(/<@!?\d+>/g, "")
  .replace(/<@&\d+>/g, "")
  .replace(/<#\d+>/g, "")
  .replace(/@(everyone|here)/g, "")
  .replace(/<t:(\d+)(?::\w)?>/g, (_, t) => new Date(+t * 1000).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " ET")
  .replace(/^[ \t]+/gm, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

const who = (m: Msg) => m.member?.nick || m.author.global_name || m.author.username;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json",
    "cache-control": "public, max-age=120",
    "netlify-cdn-cache-control": status === 200 ? "public, s-maxage=600, stale-while-revalidate=1800" : "public, s-maxage=60",
  },
});

export default async () => {
  const token = Netlify.env.get("DISCORD_BOT_TOKEN");
  const annId = Netlify.env.get("DISCORD_ANNOUNCE_CHANNEL_ID");
  const galId = Netlify.env.get("DISCORD_GALLERY_CHANNEL_ID");
  if (!token || (!annId && !galId)) return json({ error: "not_configured" }, 503);

  const out: { announcements: unknown[]; gallery: unknown[] } = { announcements: [], gallery: [] };

  if (annId) {
    try {
      const ms = await messages(annId, token);
      out.announcements = ms
        .map(m => {
          const e = (m.embeds || [])[0];
          const text = clean([m.content, e?.title && `**${e.title}**`, e?.description].filter(Boolean).join("\n\n"));
          const img = (m.attachments || []).find(a => (a.content_type || "").startsWith("image/") || IMG.test(a.filename || ""))?.url
                   || e?.image?.url || null;
          return { text, image: img, author: who(m), date: m.timestamp, link: `https://discord.com/channels/${GUILD}/${annId}/${m.id}` };
        })
        .filter(a => a.text || a.image)
        .slice(0, 3);
    } catch { /* leave empty */ }
  }

  if (galId) {
    try {
      const ms = await messages(galId, token);
      const seen = new Set<string>(), caps = new Set<string>();
      for (const m of ms) {
        const e = (m.embeds || [])[0];
        const caption = clean(e?.title || e?.description || m.content || "").replace(/[*_`>#]/g, "").split("\n")[0].slice(0, 140);
        const urls = [
          ...(m.attachments || []).filter(a => (a.content_type || "").startsWith("image/") || IMG.test(a.filename || "")).map(a => a.url),
          ...(m.embeds || []).map(x => x.image?.url).filter((u): u is string => !!u && /^https:/.test(u)),
        ];
        // Skip repeat drops (same caption) so the slideshow stays varied.
        if (caption && caps.has(caption.toLowerCase())) continue;
        if (caption) caps.add(caption.toLowerCase());
        // Loot bots/webhooks already name the player in the caption, so don't credit the bot.
        const author = m.webhook_id || m.author.bot ? "" : who(m);
        for (const url of urls) {
          const key = url.split("?")[0];
          if (seen.has(key)) continue;
          seen.add(key);
          out.gallery.push({ url, caption, author, date: m.timestamp });
        }
        if (out.gallery.length >= 15) break;
      }
    } catch { /* leave empty */ }
  }

  if (!out.announcements.length && !out.gallery.length) return json({ error: "empty" }, 502);
  return json(out);
};

export const config = { path: "/api/discord-feed" };
