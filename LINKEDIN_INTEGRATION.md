# LinkedIn Integration Requirements

## Overview
This document outlines what's needed to integrate LinkedIn posting functionality into the Tasks page.

## Current Status
✅ Frontend widget created (`LinkedInPostWidget.tsx`)
✅ UI ready for content input and image URL
⏳ Backend integration pending

---

## What's Needed from LinkedIn/CEO

### 1. LinkedIn Developer Account Setup
- [ ] Create LinkedIn Developer App at https://www.linkedin.com/developers/
- [ ] Get Client ID and Client Secret
- [ ] Configure OAuth 2.0 redirect URIs

### 2. Required LinkedIn Permissions (Scopes)
The app needs these permissions:
- `w_member_social` - Post on behalf of member
- `r_liteprofile` - Read basic profile info
- `openid` - OpenID Connect
- `profile` - Access profile data

### 3. LinkedIn API Access
- [ ] Apply for LinkedIn Marketing Developer Program (if needed)
- [ ] Get approval for `w_member_social` permission
- [ ] Note: Some permissions require LinkedIn review

### 4. Information Needed from CEO
- [ ] Which LinkedIn account to use? (Company page or personal?)
- [ ] LinkedIn page ID (if posting to company page)
- [ ] Who will authorize the app? (Need LinkedIn account credentials)
- [ ] Posting frequency expectations
- [ ] Content guidelines/brand voice

---

## Technical Implementation Required

### Backend (Lambda + Terraform)

#### 1. New Lambda: `linkedin-poster`
```
lambda/linkedin-poster/
├── package.json
├── tsconfig.json
└── src/
    └── handler.ts
```

**Responsibilities:**
- Handle LinkedIn OAuth flow
- Store/retrieve access tokens from DynamoDB
- Post content via LinkedIn UGC API
- Handle image uploads to LinkedIn

#### 2. DynamoDB Storage
Store LinkedIn tokens similar to Google OAuth:
```typescript
{
  PK: "USER#<user_id>",
  SK: "LINKEDIN_TOKEN#v0",
  entityType: "LINKEDIN_TOKEN",
  access_token: string,
  refresh_token: string,
  expires_at: number,
  linkedin_urn: string, // e.g., "urn:li:person:xxxxx"
  connected_at: string
}
```

#### 3. Terraform Resources
```hcl
# IAM Role
resource "aws_iam_role" "linkedin_poster" {
  name = "${local.prefix}-linkedin-poster-role"
}

# IAM Policy
resource "aws_iam_role_policy" "linkedin_poster" {
  # DynamoDB access for tokens
  # S3 access for images
  # CloudWatch logs
}

# Lambda Function
resource "aws_lambda_function" "linkedin_poster" {
  function_name = "${local.prefix}-linkedin-poster"
  handler       = "handler.handler"
  runtime       = var.lambda_runtime
  timeout       = 30
}

# API Gateway Route
resource "aws_apigatewayv2_route" "linkedin_post" {
  route_key = "POST /linkedin/post"
  target    = "integrations/${aws_apigatewayv2_integration.linkedin_poster.id}"
}
```

#### 4. Environment Variables
```bash
LINKEDIN_CLIENT_ID=<from_linkedin_app>
LINKEDIN_CLIENT_SECRET=<from_linkedin_app>
DYNAMODB_TABLE=<existing_table>
ATTACHMENTS_BUCKET=<existing_bucket>
```

---

## LinkedIn API Endpoints Needed

### 1. OAuth Flow
```
GET  https://www.linkedin.com/oauth/v2/authorization
POST https://www.linkedin.com/oauth/v2/accessToken
POST https://www.linkedin.com/oauth/v2/refreshToken
```

### 2. Post Creation
```
POST https://api.linkedin.com/v2/ugcPosts
Headers:
  Authorization: Bearer <access_token>
  Content-Type: application/json

Body:
{
  "author": "urn:li:person:<person_id>",
  "lifecycleState": "PUBLISHED",
  "specificContent": {
    "com.linkedin.ugc.ShareContent": {
      "shareCommentary": {
        "text": "Post content here"
      },
      "shareMediaCategory": "NONE" // or "IMAGE"
    }
  },
  "visibility": {
    "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"
  }
}
```

### 3. Image Upload (if needed)
```
POST https://api.linkedin.com/v2/assets?action=registerUpload
POST https://api.linkedin.com/v2/assets/<asset_id>
```

---

## Frontend Changes Needed

### 1. API Client Method
```typescript
// frontend/src/api/client.ts
export async function postToLinkedIn(content: string, imageUrl?: string): Promise<{ success: boolean; postId?: string }> {
  const base = import.meta.env.VITE_API_BASE_URL;
  const { data: { session } } = await supabase.auth.getSession();
  
  const response = await fetch(`${base}/linkedin/post`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: session.user.id,
      content,
      image_url: imageUrl,
    }),
  });
  
  return response.json();
}
```

### 2. LinkedInPostWidget Integration
Update the widget to call the real API instead of mock.

---

## Testing Checklist

- [ ] LinkedIn OAuth flow works
- [ ] Can connect LinkedIn account
- [ ] Can post text-only updates
- [ ] Can post with images
- [ ] Token refresh works automatically
- [ ] Error handling for expired tokens
- [ ] Rate limiting (LinkedIn: 100 posts/day per user)

---

## LinkedIn Rate Limits
- **Posts**: 100 per day per member
- **API Calls**: Varies by endpoint
- **Image Upload**: 10MB max per image

---

## Security Considerations
- Store LinkedIn tokens encrypted in DynamoDB
- Use HTTPS for all OAuth callbacks
- Validate LinkedIn webhooks (if used)
- Implement token refresh before expiry
- Log all posting activity for audit

---

## Next Steps
1. Get LinkedIn Developer account credentials from CEO
2. Create LinkedIn app and get permissions approved
3. Implement backend Lambda for LinkedIn posting
4. Update frontend widget to use real API
5. Test end-to-end flow
6. Deploy to production

---

## Questions for CEO
1. Do you have a LinkedIn Developer account?
2. Which LinkedIn account should be used? (Personal or Company)
3. What type of content will be posted? (B2B updates, product news, etc.)
4. How often will posts be made?
5. Do you need scheduling functionality?
6. Should posts be approved before publishing?