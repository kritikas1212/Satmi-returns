// Allowed support/admin emails for Satmi backend dashboard.
// Add users with these emails in Firebase Console (Authentication > Add user, Email/Password).
export const ADMIN_EMAILS = ["kritika@satmi.in", "support@satmi.in"];

export function isAdminEmail(email) {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.trim().toLowerCase());
}
