# Client Chat App

A React Native/Expo chat application with a ChatGPT-like interface, built with TypeScript and Storybook.

## Features

- **Chat Interface**: Modern chat UI similar to ChatGPT
- **Cross-Platform**: Works on mobile (iOS/Android) and web
- **TypeScript**: Full type safety
- **Storybook**: Component development and testing
- **Stubbed API**: Demo responses for testing

## Setup

### Prerequisites

- Node.js (v18 or higher)
- npm or yarn
- Expo CLI (optional, for development)

### Installation

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start the development server:**
   ```bash
   npm start
   ```

## Running the App

### Mobile Development

- **iOS Simulator:**
  ```bash
  npm run ios
  ```

- **Android Emulator:**
  ```bash
  npm run android
  ```

- **Physical Device:**
  ```bash
  npm start
  ```
  Then scan the QR code with the Expo Go app.

### Web Development

```bash
npm run web
```

The app will open in your default browser at `http://localhost:19006`.

## Storybook

This project includes Storybook for component development and testing.

### Running Storybook

#### Headless Mode (CI/CD)
```bash
npm run storybook:headless
```
- Runs Storybook in headless mode
- Logs are written to stdout in structured format
- Suitable for automated testing and CI/CD pipelines
- Cursor can parse logs for debugging

#### Headful Mode (Browser)
```bash
npm run storybook:headful
```
- Opens Storybook in your browser at `http://localhost:6006`
- Interactive development environment
- Supports interaction tests
- Visual component testing

### Storybook Features

- **Component Stories**: Individual component testing
- **Interaction Tests**: Test user interactions
- **Controls**: Dynamic prop manipulation
- **Actions**: Monitor component events
- **Documentation**: Auto-generated component docs

### Available Stories

- **Message Component**: Test different message types and states
- **ChatInput Component**: Test input behavior and loading states
- **ChatScreen**: Full chat interface testing

## Project Structure

```
client/
├── src/
│   ├── components/
│   │   ├── ChatScreen.tsx      # Main chat interface
│   │   ├── Message.tsx         # Individual message component
│   │   ├── ChatInput.tsx       # Message input component
│   │   └── *.stories.tsx       # Storybook stories
│   └── services/
│       └── chatApi.ts          # API client with stubbed responses
├── .storybook/                 # Web Storybook configuration
├── .rnstorybook/              # React Native Storybook configuration
└── package.json
```

## API Integration

The app currently uses a stubbed API that returns mock responses. The API client is located in `src/services/chatApi.ts`.

### Stubbed Responses

The API responds to various keywords:
- "hello" / "hi" → Greeting response
- "how are you" → Status response
- "weather" → Weather-related response
- "help" → Help information
- "betfair" / "betting" → Betfair-specific response
- Default → Generic acknowledgment

### Integration with Backend

To connect to the actual Betfair NLP backend:

1. Update the `baseUrl` in `src/services/chatApi.ts`
2. Implement proper API authentication
3. Replace stubbed responses with actual API calls

## Development

### Code Style

- TypeScript for type safety
- Prettier for code formatting
- ESLint for code linting

### Testing

- Storybook for component testing
- Interaction tests for user behavior
- Visual regression testing

### Debugging

#### Logs in Headless Mode
When running Storybook in headless mode, logs are written to stdout in a structured format:

```json
{
  "level": "info",
  "message": "Storybook started",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "port": 6006
}
```

#### Cursor Integration
The structured logs are designed to be parsed by Cursor for debugging:
- Clear log levels (info, warn, error)
- Structured JSON format
- Timestamp information
- Component-specific context

## Troubleshooting

### Common Issues

1. **Metro bundler issues:**
   ```bash
   npx expo start --clear
   ```

2. **Storybook not loading:**
   ```bash
   npm run storybook:build
   ```

3. **TypeScript errors:**
   ```bash
   npx tsc --noEmit
   ```

### Platform-Specific Issues

#### iOS
- Ensure Xcode is installed
- Run `npx expo run:ios` for native builds

#### Android
- Ensure Android Studio is installed
- Set up Android SDK
- Run `npx expo run:android` for native builds

#### Web
- Clear browser cache
- Check for CORS issues with API calls

## Contributing

1. Create a feature branch
2. Write Storybook stories for new components
3. Test on multiple platforms
4. Update documentation
5. Submit a pull request

## License

MIT License - see the main project README for details.
