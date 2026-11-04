# FAQ

## General

### What is CloudVault?

A shared password vault for small organizations. Everyone in an organization can reach the passwords they need, every view is logged, and the passwords are encrypted in each person's browser so the server never sees them.

### Who is it for?

Nonprofits, boards, clubs, volunteer groups and small teams who need to share logins (bank, payroll, social media, domain registrar, Wi-Fi) without emailing them around, and who want a record of who accessed what. It runs on Cloudflare's free plan.

### Is it really free?

The software is MIT licensed. Hosting fits Cloudflare's free plan for a typical small organization (see the [budget table](../README.md#free-plan-budget)). Emailed login links use Resend's free tier.

## Security

### How are my passwords protected?

Your master password unlocks your personal key on your device. That key unlocks your organization's key, which decrypts the items. All of this happens in your browser. The server stores only encrypted data. Details are in [SECURITY.md](SECURITY.md).

### What can the server (or someone who steals the database) see?

Item names, websites, usernames, categories, tags, expiry dates, email addresses and the audit log. It cannot see passwords, notes, card details, API keys, 2FA secrets or custom fields. Keep sensitive details out of item names.

### I forgot my master password. Can an admin reset it?

No. Nobody can, which is what keeps your data private from the server and from admins. Sign in, set up a new master password (an admin may need to remove and re-invite you), and an admin can approve you again. Items in the shared vault are not lost; only your personal access is reset.

### Why do I have to read a "fingerprint" to an admin?

When you join, the admin's browser encrypts the vault key for your public key. The fingerprint check confirms that the key the server handed the admin really is yours. Without it, a compromised server could substitute its own key. Find yours under **Preferences and security** (unlock first).

### Does CloudVault support two-factor login?

Sign-in is through GitHub (use GitHub's own 2FA) or an emailed link (protect your email with 2FA). Separately, CloudVault can store 2FA secrets for your other accounts and show their current codes.

### What happens when someone leaves?

An admin removes them on the **Members** page, and CloudVault offers to rotate the vault key right away. Rotation re-encrypts everything with a new key. Also change the passwords that person used, because they may remember or have saved them.

## Using CloudVault

### How do I add a password?

Click **New item** (or press `n`), choose the type, and fill it in. Use **Generate** for a strong random password.

### How do I import from another password manager?

Export a CSV from Bitwarden, LastPass or another manager, then use **Import / Export** in CloudVault. Delete the CSV afterwards; it is not encrypted.

### How do I back up the vault?

**Import / Export > Encrypted backup** downloads a file protected by a passphrase you choose. It can be restored into any CloudVault organization.

### Keyboard shortcuts

When you're not typing in a field:

| Key | Action |
|-----|--------|
| `/` | Search |
| `n` | New item |
| `l` | Lock the vault |

### How do I share a password with someone outside the organization?

Open the item and choose **Share**. Pick how long the link lasts and how many times it can be opened, and optionally add a password. Copy the link. The part after `#` is the decryption key, and CloudVault never sees it. Send the password, if you set one, through a different channel. You can revoke links from the item's **Sharing** tab.

### What is emergency access?

Admins can name a trusted person (for example a board chair) as an emergency contact. If every admin becomes unreachable, that person opens **Emergency access** from their account menu and requests access. Admins are emailed and can deny it during the waiting period; afterwards the contact gets read-only access.

### Why did the vault lock?

The vault locks after the inactivity period in your preferences, when you press `l` or **Lock**, and whenever the page is reloaded (your keys only live in memory). The server separately signs you out after the same idle period.

### Why did my copied password disappear?

CloudVault clears copied passwords from the clipboard after a delay (30 seconds by default). Change it under **Preferences and security**.

## Administration

### Can I limit who can sign up?

Yes. Set `ALLOW_SIGNUPS = "false"` in `wrangler.toml` and redeploy. Then only people an admin has invited can sign in.

### How long is the audit log kept?

365 days by default. Admins can change it under **Settings > Policies** (30 days to 10 years). A daily job deletes older entries.

### Can I self-host somewhere other than Cloudflare?

The API is built for Cloudflare Workers and D1. Porting it would mean replacing the D1 queries and the Worker entry point.
