# CloudVault FAQ

Frequently asked questions about using CloudVault.

## General

### What is CloudVault?

CloudVault is a secure, zero-knowledge password manager that lets you store and share passwords with your team. "Zero-knowledge" means your passwords are encrypted on your device before being sent to our servers - we never see your actual passwords.

### Is CloudVault free?

Yes! CloudVault runs on Cloudflare's free tier, making it completely free to host for small teams. You only pay if you exceed Cloudflare's generous free tier limits.

### Who is CloudVault for?

CloudVault is designed for:
- Small businesses and startups
- Non-profit organizations
- Teams that need to share credentials securely
- Anyone who wants full control over their password data

## Security

### How secure is CloudVault?

CloudVault uses industry-standard encryption:
- **AES-256-GCM** for encrypting your passwords
- **RSA-4096** for your personal encryption keys
- **PBKDF2** with 100,000 iterations for key derivation
- All encryption happens in your browser - unencrypted data never leaves your device

### Can CloudVault staff see my passwords?

No. CloudVault is "zero-knowledge" - your passwords are encrypted before they reach our servers. Without your master password, your data is unreadable. Even if someone gained access to the database, they would only see encrypted gibberish.

### What if I forget my master password?

Unfortunately, we cannot recover your passwords if you forget your master password. This is by design - it's what makes CloudVault truly zero-knowledge. We recommend:
- Using a memorable but strong passphrase
- Writing down your master password and storing it in a safe place
- Setting up emergency access contacts who can request access if needed

### Is two-factor authentication (2FA) supported?

CloudVault supports storing TOTP 2FA codes for your other accounts. You can view real-time 2FA codes directly in CloudVault.

Organization-wide 2FA enforcement for CloudVault login is coming soon.

## Getting Started

### How do I create an account?

1. Go to your CloudVault instance
2. Click "Sign in with GitHub" or enter your email for a magic link
3. Complete the setup by creating your master password
4. Create or join an organization

### How do I add my first password?

1. Make sure you're logged in and have selected an organization
2. Click the "+ Add Password" button (or press Ctrl+N)
3. Fill in the name, URL, username, and password
4. Click "Add Password"

### How do I import passwords from another password manager?

1. Go to the "Import/Export" page
2. Select your current password manager (Bitwarden, LastPass, or generic CSV)
3. Export your passwords from your old password manager as CSV
4. Upload the CSV file to CloudVault
5. Review the preview and click "Import"

## Organizations

### What is an organization?

An organization is a shared vault where multiple users can access the same passwords. Each organization has its own encryption key, and members can have different permission levels.

### What are the different roles?

- **Admin**: Full access, can manage users, settings, and view audit logs
- **Member**: Can view and edit passwords
- **Read Only**: Can only view passwords, cannot make changes

### How do I invite someone to my organization?

1. Go to "Users" (requires admin role)
2. Click "Invite User"
3. Enter their email address
4. They'll receive an email to set up their account
5. Once they've completed setup, return to approve their access

### Why do I need to approve new members?

When you approve a new member, CloudVault securely transfers the organization's encryption key to them. This two-step process ensures that only authorized users receive access to decrypt the passwords.

## Features

### How do I search for passwords?

- Use the search box at the top of the password list
- Press Ctrl+K (or Cmd+K on Mac) from anywhere to focus the search
- Search by name, URL, or username

### What are keyboard shortcuts?

- **Ctrl+K** / **Cmd+K**: Focus search
- **Ctrl+N** / **Cmd+N**: Create new password
- **Ctrl+L** / **Cmd+L**: Lock vault

### How do I share a password with someone outside my organization?

1. Open the password you want to share
2. Click the "Share" button
3. Set an expiration time and maximum views
4. Optionally add a password for extra security
5. Copy the share link and send it to the recipient

Share links are temporary and can be revoked at any time.

### What is emergency access?

Emergency access allows you to designate trusted contacts who can request access to your organization's passwords if you become unavailable. When they request access:
1. A waiting period begins (default: 48 hours)
2. You receive a notification and can deny the request
3. If not denied, access is automatically granted after the waiting period

## Troubleshooting

### I can't log in

- Make sure you're using the correct email address
- If using GitHub login, ensure your GitHub email matches your CloudVault account
- Try clearing your browser cache and cookies
- Check if magic link emails are going to your spam folder

### The vault shows as "locked"

This means your session has expired or you need to re-enter your master password. Click "Unlock" and enter your master password to continue.

### I can't see any passwords

- Make sure you've selected an organization from the dropdown
- Ensure your master password is correct (vault is unlocked)
- If you're new to the organization, your admin may need to approve your membership

### Import failed

- Ensure your CSV file is in the correct format
- Check that the file isn't too large (max 10MB)
- Try exporting from your old password manager again
- For generic CSV, ensure columns are named: name, url, username, password

### I'm getting "Too many requests" error

CloudVault has rate limiting to prevent abuse. Wait a few minutes and try again. If this persists, contact your administrator.

## Data & Privacy

### Where is my data stored?

CloudVault stores encrypted data on Cloudflare's global network. Your data is replicated across multiple regions for reliability, but it's always encrypted with your organization's unique key.

### Can I export my data?

Yes! Go to "Import/Export" and click "Download Export" to download all your passwords. The export file contains encrypted data that can be imported back into CloudVault.

### How do I delete my account?

Contact your organization admin to remove you from the organization. If you're the only admin, you can delete the entire organization from Settings.

### What happens if CloudVault shuts down?

Since CloudVault is open source and self-hosted, you control your own instance. You can export your data at any time. If you're using someone else's instance, make sure to regularly export backups.

## Technical

### What browsers are supported?

CloudVault works in all modern browsers:
- Chrome (recommended)
- Firefox
- Safari
- Edge

Note: Internet Explorer is not supported.

### Is there a mobile app?

CloudVault is a Progressive Web App (PWA) and works well on mobile browsers. You can add it to your home screen for an app-like experience. Native mobile apps are planned for the future.

### Can I self-host CloudVault?

Yes! CloudVault is designed for easy self-hosting on Cloudflare's free tier. See the deployment documentation for step-by-step instructions.

### What's the maximum number of passwords I can store?

There's no hard limit, but very large vaults (10,000+ passwords) may experience slower performance. For most teams, CloudVault handles thousands of passwords without issues.

---

## Still have questions?

- Check our [documentation](./README.md)
- Review the [security documentation](./SECURITY.md)
- Open an issue on GitHub in the project repository
