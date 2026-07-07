import { extractText, generateNvidiaContent, NVIDIA_CHAT_MODEL } from '../nvidia.mjs';
import { executeTool, toolDeclarations } from './tools.mjs';

const MAX_TOOL_ROUNDS = 4;

export async function answerWithTools({ question, lat, lng }) {
  const messages = [
    {
      role: 'user',
      content: buildPrompt(question, lat, lng),
    },
  ];
  const toolsUsed = [];

  const tools = toolDeclarations.map((decl) => ({
    type: 'function',
    function: decl,
  }));

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const data = await generateNvidiaContent({
      model: NVIDIA_CHAT_MODEL,
      messages,
      tools,
      tool_choice: 'auto',
      temperature: 0.2,
      max_tokens: 700,
    });

    const candidateMessage = data.choices?.[0]?.message;
    if (!candidateMessage) {
      return {
        answer: 'The NVIDIA API returned an empty response.',
        toolsUsed: unique(toolsUsed),
      };
    }

    const toolCalls = candidateMessage.tool_calls || [];

    if (toolCalls.length === 0) {
      const answer = candidateMessage.content?.trim();
      return {
        answer: answer || 'I could not produce an answer from the available civic tools.',
        toolsUsed: unique(toolsUsed),
      };
    }

    messages.push(candidateMessage);

    for (const toolCall of toolCalls) {
      const name = toolCall.function.name;
      let args = {};
      try {
        args = JSON.parse(toolCall.function.arguments || '{}');
      } catch (e) {
        console.error('Failed to parse tool arguments:', toolCall.function.arguments);
      }
      
      args = withLocationDefaults(name, args, lat, lng);
      
      let result;
      try {
        result = await executeTool(name, args);
        toolsUsed.push(name);
      } catch (e) {
        result = { error: e.message };
      }

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      });
    }
  }

  messages.push({
    role: 'user',
    content: 'Summarize the tool results above into a concise civic operations answer.',
  });

  const finalData = await generateNvidiaContent({
    model: NVIDIA_CHAT_MODEL,
    messages,
    temperature: 0.2,
    max_tokens: 500,
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
  if (name === 'check_route') {
    return {
      ...args,
      _userLat: lat,
      _userLng: lng,
    };
  }

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
