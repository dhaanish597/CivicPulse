import { extractText, generateGeminiContent } from '../gemini.mjs';
import { executeTool, toolDeclarations } from './tools.mjs';

const MAX_TOOL_ROUNDS = 4;

export async function answerWithTools({ question, lat, lng }) {
  const contents = [
    {
      role: 'user',
      parts: [
        {
          text: buildPrompt(question, lat, lng),
        },
      ],
    },
  ];
  const toolsUsed = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const data = await generateGeminiContent({
      contents,
      tools: [{ function_declarations: toolDeclarations }],
      tool_config: {
        function_calling_config: {
          mode: 'auto',
        },
      },
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 700,
      },
    });

    const candidateContent = data.candidates?.[0]?.content;
    const parts = candidateContent?.parts ?? [];
    const functionCalls = parts.map((part) => part.functionCall).filter(Boolean);

    if (functionCalls.length === 0) {
      const answer = extractText(data);
      return {
        answer: answer || 'I could not produce an answer from the available civic tools.',
        toolsUsed: unique(toolsUsed),
      };
    }

    contents.push(candidateContent);

    const functionResponses = [];
    for (const functionCall of functionCalls) {
      const name = functionCall.name;
      const args = withLocationDefaults(name, functionCall.args ?? {}, lat, lng);
      const result = await executeTool(name, args);
      toolsUsed.push(name);
      functionResponses.push({
        functionResponse: {
          name,
          response: {
            result,
          },
        },
      });
    }

    contents.push({
      role: 'function',
      parts: functionResponses,
    });
  }

  const finalData = await generateGeminiContent({
    contents: [
      ...contents,
      {
        role: 'user',
        parts: [{ text: 'Summarize the tool results above into a concise civic operations answer.' }],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 500,
    },
  });

  return {
    answer: extractText(finalData) || 'The tool loop reached its limit before producing a final answer.',
    toolsUsed: unique(toolsUsed),
  };
}

function buildPrompt(question, lat, lng) {
  const locationLine = Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))
    ? `User coordinates are lat=${lat}, lng=${lng}. Use get_nearby_issues for questions about nearby issues.`
    : 'No user coordinates were provided. If the user asks about nearby issues, explain that location access is needed.';

  return [
    'You are CivicPulse, a municipal operations assistant for Hyderabad civic complaints.',
    'Use the available tools when the question asks about nearby issues, ward summaries, hotspots, forecasts, or dispatch priority.',
    'Ground every answer in tool results. Do not invent complaint rows or live city data.',
    locationLine,
    `Question: ${question}`,
  ].join('\n');
}

function withLocationDefaults(name, args, lat, lng) {
  if (name !== 'get_nearby_issues') return args;

  return {
    ...args,
    lat: args.lat ?? lat,
    lng: args.lng ?? lng,
    radius_km: args.radius_km ?? 2,
  };
}

function unique(values) {
  return Array.from(new Set(values));
}
