import OpenAI from "openai";

export async function completes(
  {
    baseURL,
    apiKey,
    model,
    maxTokens
  },
  messages
) {
  const openai = new OpenAI({
    //实例化一个OpenAI类
    baseURL,
    apiKey,
  });

  const completion = await openai.chat.completions.create({
    messages,
    model,
    frequency_penalty: 0,
    max_tokens: maxTokens || 300,
    temperature: 0.1
  });

  console.log('[GPT-Request] 响应:', {
    content: completion.choices[0].message.content,
    usage: completion.usage
  });
  return completion;
}