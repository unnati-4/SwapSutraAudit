/**
 * Responsive, clean HTML Email Template Generator for SwapSutra
 */

interface EmailTemplateOptions {
  recipientName?: string;
  title: string;
  message: string;
  category: string;
  ctaText?: string;
  ctaUrl: string;
  senderName?: string;
  entityName?: string;
  timestamp?: string;
}

export function generateSwapSutraEmailHtml(options: EmailTemplateOptions): string {
  const {
    recipientName = 'Dear Reader',
    title,
    message,
    category,
    ctaText = 'Open SwapSutra',
    ctaUrl,
    senderName,
    entityName,
  } = options;

  const appBaseUrl = typeof window !== 'undefined' 
    ? window.location.origin 
    : 'https://swapsutra.com';

  const fullCtaUrl = ctaUrl.startsWith('http') ? ctaUrl : `${appBaseUrl}${ctaUrl.startsWith('/') ? '' : '/'}${ctaUrl}`;

  const categoryLabel = category
    .replace(/_/g, ' ')
    .toUpperCase();

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: #FBF8F3;
      font-family: -apple-system, BlinkMacSystemFont, 'Georgia', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #2D241E;
      line-height: 1.6;
    }
    .wrapper {
      width: 100%;
      background-color: #FBF8F3;
      padding: 32px 16px;
    }
    .container {
      max-width: 580px;
      margin: 0 auto;
      background-color: #FFFFFF;
      border: 1px solid #E8DEC8;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 4px 20px rgba(45, 36, 30, 0.05);
    }
    .header {
      background-color: #3D0C11;
      padding: 28px 32px;
      text-align: center;
    }
    .header-title {
      color: #FAF4E8;
      font-family: 'Georgia', serif;
      font-size: 24px;
      font-weight: 700;
      letter-spacing: 0.1em;
      margin: 0;
      text-transform: uppercase;
    }
    .header-sub {
      color: #E2B659;
      font-size: 11px;
      letter-spacing: 0.25em;
      text-transform: uppercase;
      margin-top: 6px;
      margin-bottom: 0;
    }
    .badge-bar {
      padding: 16px 32px 0 32px;
    }
    .category-badge {
      display: inline-block;
      background-color: #F6EDE0;
      color: #8C2A34;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.15em;
      padding: 4px 12px;
      border-radius: 20px;
      border: 1px solid #E8DEC8;
    }
    .content {
      padding: 24px 32px 32px 32px;
    }
    .greeting {
      font-size: 15px;
      color: #6E5C4F;
      margin-bottom: 12px;
    }
    .email-title {
      font-family: 'Georgia', serif;
      font-size: 20px;
      color: #3D0C11;
      margin-top: 0;
      margin-bottom: 16px;
      line-height: 1.3;
    }
    .message-box {
      background-color: #FAF7F0;
      border-left: 4px solid #C4923E;
      padding: 16px 20px;
      border-radius: 0 8px 8px 0;
      font-size: 15px;
      color: #2D241E;
      margin-bottom: 24px;
    }
    .details-row {
      margin-bottom: 16px;
      font-size: 14px;
      color: #554538;
    }
    .btn-container {
      text-align: center;
      margin: 32px 0 24px 0;
    }
    .cta-button {
      display: inline-block;
      background-color: #3D0C11;
      color: #FAF4E8 !important;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.15em;
      text-transform: uppercase;
      text-decoration: none;
      padding: 14px 32px;
      border-radius: 6px;
      box-shadow: 0 4px 12px rgba(61, 12, 17, 0.2);
    }
    .footer {
      background-color: #FAF7F0;
      border-top: 1px solid #E8DEC8;
      padding: 20px 32px;
      text-align: center;
      font-size: 12px;
      color: #8A7667;
    }
    .footer a {
      color: #8C2A34;
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <div class="header">
        <h1 class="header-title">SwapSutra</h1>
        <p class="header-sub">The Physical Book Sharing Ecosystem</p>
      </div>

      <div class="badge-bar">
        <span class="category-badge">${categoryLabel}</span>
      </div>

      <div class="content">
        <p class="greeting">Hello ${recipientName},</p>
        <h2 class="email-title">${title}</h2>

        <div class="message-box">
          ${message}
        </div>

        ${senderName ? `<div class="details-row"><strong>From:</strong> ${senderName}</div>` : ''}
        ${entityName ? `<div class="details-row"><strong>Item:</strong> ${entityName}</div>` : ''}

        <div class="btn-container">
          <a href="${fullCtaUrl}" class="cta-button" target="_blank">${ctaText}</a>
        </div>
      </div>

      <div class="footer">
        <p>You received this notification based on your activity and preferences on <strong>SwapSutra</strong>.</p>
        <p>To update your notification settings or quiet hours, visit your <a href="${appBaseUrl}/profile?sub=notifications">Notification Settings</a>.</p>
        <p style="margin-top: 12px; font-size: 11px; opacity: 0.8;">SwapSutra — Connecting Readers, Sharing Books.</p>
      </div>
    </div>
  </div>
</body>
</html>
  `;
}
