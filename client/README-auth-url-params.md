# URL Parameter Authentication

## Overview
The AuthScreen now supports automatic credential loading via URL parameters, allowing users to pre-fill their login credentials and auto-login with just a press of Enter.

## Supported Formats

### 1. Plain Text Format
```
http://localhost:8081?auth=username:password
```

**Example:**
```
http://localhost:8081?auth=matthew:beyer
```

### 2. Base64 Encoded Format
```
http://localhost:8081?auth=base64encodedstring
```

**Example:**
```
http://localhost:8081?auth=bWF0dGhldzpiZXllcg==
```

## How It Works

1. **URL Parsing**: The app automatically detects the `auth` query parameter
2. **Credential Extraction**: Parses the username:password format
3. **Auto-fill**: Populates the login form fields
4. **Auto-login**: Attempts to authenticate automatically
5. **Visual Feedback**: Shows a green info box indicating credentials were loaded

## Implementation Details

### Dependencies
- `expo-linking`: For URL parameter parsing

### Key Features
- **Dual Format Support**: Both plain text and base64 encoded
- **Automatic Detection**: No manual intervention required
- **Fallback Handling**: Gracefully handles invalid formats
- **Console Logging**: Detailed logging for debugging
- **Visual Indicators**: Clear feedback when credentials are loaded

### Code Structure
```typescript
// URL parameter parsing
useEffect(() => {
  const parseUrlParams = async () => {
    const url = await Linking.getInitialURL();
    const authParam = parsed.queryParams?.auth;
    
    if (authParam) {
      // Try base64 first, fallback to plain text
      const credentials = atob(authParam) || authParam;
      const [username, password] = credentials.split(":");
      
      // Set state and auto-login
      setUsername(username);
      setPassword(password);
      handleLogin();
    }
  };
}, []);
```

## Testing

### Test Script
Run the test script to generate valid URLs:
```bash
cd client
node test-auth-urls.js
```

### Generated URLs
The script outputs:
- Plain text URL: `http://localhost:8081?auth=matthew%3Abeyer`
- Base64 URL: `http://localhost:8081?auth=bWF0dGhldzpiZXllcg==`

### Storybook Stories
- `Default`: Basic authentication screen
- `WithUrlParameters`: URL parameter testing simulation
- `PreFilledCredentials`: Shows pre-filled state

## Security Considerations

### Plain Text URLs
- **Pros**: Easy to read and debug
- **Cons**: Credentials visible in browser history, logs, and address bar
- **Use Case**: Development and testing

### Base64 Encoded URLs
- **Pros**: Credentials not immediately readable
- **Cons**: Still not secure (base64 is encoding, not encryption)
- **Use Case**: Slightly more professional appearance

### Recommendations
- Use only in development/testing environments
- Avoid sharing URLs with credentials in production
- Consider implementing proper OAuth flows for production use

## Troubleshooting

### Common Issues

1. **Credentials Not Loading**
   - Check console for error messages
   - Verify URL format: `?auth=username:password`
   - Ensure the app is running on the correct port

2. **Auto-login Not Working**
   - Check if credentials are valid (matthew:beyer)
   - Verify the `onAuthenticated` callback is working
   - Check console for authentication errors

3. **Base64 Decoding Issues**
   - Verify the base64 string is valid
   - Use the test script to generate correct encoding
   - Check for URL encoding issues

### Debug Information
The component logs detailed information to the console:
- 🔐 Found auth parameter
- ✅ Decoded base64 credentials / 📝 Using plain text credentials
- 👤 Setting credentials from URL
- 🚀 Attempting auto-login

## Future Enhancements

### Potential Improvements
1. **Encrypted URLs**: Implement proper encryption for credentials
2. **Token-based Auth**: Use JWT tokens instead of plain credentials
3. **OAuth Integration**: Support for OAuth providers
4. **Session Management**: Remember login state across app restarts
5. **Biometric Auth**: Add fingerprint/face ID support

### Code Examples
```typescript
// Future: Encrypted credentials
const encryptedAuth = encryptCredentials(username, password, secretKey);
const secureUrl = `http://localhost:8081?auth=${encryptedAuth}`;

// Future: Token-based
const tokenUrl = `http://localhost:8081?token=${jwtToken}`;
```

## Files Modified
- `AuthScreen.tsx`: Added URL parameter parsing and auto-login
- `AuthScreen.stories.tsx`: Added Storybook stories for testing
- `test-auth-urls.js`: URL generation and testing script
- `package.json`: Added expo-linking dependency
