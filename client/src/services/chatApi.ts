interface ChatResponse {
  reply: string;
}

class ChatApi {
  private baseUrl = "https://api.example.com/chat"; // This will be replaced with actual API

  async sendMessage(message: string): Promise<ChatResponse> {
    // Simulate API delay
    await new Promise(resolve =>
      setTimeout(resolve, 1000 + Math.random() * 2000)
    );

    // Return stubbed responses based on message content
    const lowerMessage = message.toLowerCase();

    if (lowerMessage.includes("hello") || lowerMessage.includes("hi")) {
      return {
        reply: "Hello! I'm your AI assistant. How can I help you today?",
      };
    }

    if (lowerMessage.includes("how are you")) {
      return {
        reply:
          "I'm doing well, thank you for asking! I'm here to help you with any questions or tasks you might have.",
      };
    }

    if (lowerMessage.includes("weather")) {
      return {
        reply:
          "I'm sorry, I don't have access to real-time weather data yet. This is a stubbed response for demonstration purposes.",
      };
    }

    if (lowerMessage.includes("help")) {
      return {
        reply:
          "I can help you with various tasks! Just ask me questions and I'll do my best to assist you. This is currently a demo with stubbed responses.",
      };
    }

    if (lowerMessage.includes("betfair") || lowerMessage.includes("betting")) {
      return {
        reply:
          "I see you're interested in Betfair! This chat app is part of a larger Betfair NLP project. I can help you with questions about betting data analysis and processing.",
      };
    }

    // Default response
    return {
      reply: `Thanks for your message: "${message}". This is a stubbed response from the demo chat API. In a real implementation, this would connect to an actual AI service.`,
    };
  }
}

export const chatApi = new ChatApi();
