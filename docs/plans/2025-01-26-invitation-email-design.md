# Invitation Email Workflow Design

## Overview

Send email notifications when users are invited to an organization, using Resend as the email provider.

## Architecture

```
invitation.create ─┐
                   ├──► sendInvitationEmail() ──► Resend API
admin.inviteUser ──┘           │
                               │
                       ┌───────┴───────┐
                       │               │
                    Success          Failure
                       │               │
                 Save to DB      Throw TRPCError
                       │         (no DB write)
                 Return invite
```

## Files

**New:**
- `src/lib/email.ts` - Resend client and `sendInvitationEmail()` function

**Modified:**
- `src/server/routers/invitation.ts` - Call email before DB write
- `src/server/routers/admin.ts` - Same pattern for SuperAdmin invites

## Email Content

**Subject:** `You've been invited to join {orgName} on Policy Hub`

**Body:**
- Greeting
- Inviter name and organization
- Role being assigned
- Brief product description
- Accept button (primary CTA)
- Expiry date
- Fallback plain-text URL

**From:** `Policy Hub <noreply@{verified-domain}>` (or Resend test domain)

## Implementation Flow

1. Validate inputs (existing)
2. Check user not already member (existing)
3. Check no pending invitation (existing)
4. Calculate expiry date (existing)
5. **Generate invitation ID upfront**
6. **Send email via Resend** - if this fails, mutation fails
7. Create invitation in DB with pre-generated ID
8. Log audit event (existing)
9. Return invitation (existing)

## Error Handling

- If email sending fails, the entire operation fails
- No invitation is created in the database
- TRPCError is thrown with the Resend error message
- Admin is informed immediately of delivery issues

## Environment Variables

- `RESEND_API_KEY` - API key from Resend dashboard
- `NEXT_PUBLIC_APP_URL` - Base URL for invitation links

## Dependencies

- `resend` - Resend SDK for sending emails
