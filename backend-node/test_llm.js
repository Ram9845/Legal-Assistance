import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.NVIDIA_API_KEY,
  baseURL: 'https://integrate.api.nvidia.com/v1',
});

async function main() {
  console.log("Starting LLM call...");
  const start = Date.now();
  const completion = await openai.chat.completions.create({
    model: "nvidia/nemotron-3-ultra-550b-a55b",
    messages: [{"role":"user","content":"Hello, how long do you take to answer?"}],
    temperature: 0.2,
    top_p: 0.7,
    max_tokens: 1024,
    chat_template_kwargs: {"enable_thinking":true},
  });
  console.log("Done in", (Date.now() - start) / 1000, "seconds");
  console.log(completion.choices[0]?.message?.content);
}
main();
