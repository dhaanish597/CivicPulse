import { Markup, Telegraf } from 'telegraf';
import { getLocalityByName, localities } from './data/localities.mjs';
import { runPipeline } from './agents/orchestrator.mjs';
import { redactError } from './utils.mjs';

const chatLocations = new Map();

export async function startTelegramBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn('Telegram bot disabled: TELEGRAM_BOT_TOKEN is not set.');
    return null;
  }

  const bot = new Telegraf(token);

  bot.start((ctx) => ctx.reply(
    [
      'Welcome to CivicPulse.',
      'Share your location or type one of the supported Hyderabad locality names, then send a civic issue photo with an optional caption.',
      `Supported localities: ${localities.map((item) => item.locality).join(', ')}`,
    ].join('\n\n'),
    locationKeyboard(),
  ));

  bot.on('location', (ctx) => {
    const location = ctx.message.location;
    chatLocations.set(ctx.chat.id, {
      lat: location.latitude,
      lng: location.longitude,
      label: 'shared Telegram location',
    });

    return ctx.reply('Location saved. Send a photo with an optional caption to log a complaint.');
  });

  bot.on('text', (ctx) => {
    const locality = getLocalityByName(ctx.message.text);
    if (!locality) {
      return ctx.reply('I did not recognize that locality. Share your location or type a supported locality name.', locationKeyboard());
    }

    chatLocations.set(ctx.chat.id, {
      ward: locality.ward,
      locality: locality.locality,
      lat: locality.lat,
      lng: locality.lng,
      label: `${locality.locality}, Ward ${locality.ward}`,
    });

    return ctx.reply(`Saved ${locality.locality}, Ward ${locality.ward}. Send a photo with an optional caption to log a complaint.`);
  });

  bot.on('photo', async (ctx) => {
    const location = chatLocations.get(ctx.chat.id);
    if (!location) {
      await ctx.reply('Before logging the photo, share your location or type your locality name.', locationKeyboard());
      return;
    }

    try {
      const photo = ctx.message.photo.at(-1);
      const fileUrl = await ctx.telegram.getFileLink(photo.file_id);
      const imageResponse = await fetch(fileUrl.href);
      if (!imageResponse.ok) throw new Error(`Telegram file download failed with ${imageResponse.status}`);

      const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
      const result = await runPipeline({
        textNote: ctx.message.caption ?? 'Photo complaint submitted through Telegram.',
        image: {
          data: imageBuffer.toString('base64'),
          mimeType: 'image/jpeg',
        },
        ward: location.ward,
        locality: location.locality,
        lat: location.lat,
        lng: location.lng,
        source: 'Telegram',
      });

      await ctx.reply(
        [
          `Report ${result.complaint.id} logged, thank you.`,
          `Classification: ${result.complaint.category}, severity ${result.complaint.severity}/5.`,
          result.duplicateOf ? `Likely duplicate of ${result.duplicateOf}.` : result.recommendation,
        ].filter(Boolean).join('\n'),
      );
    } catch (error) {
      console.error('Telegram photo intake failed:', redactError(error));
      await ctx.reply('Sorry, I could not log that photo report right now. Please try again.');
    }
  });

  await bot.launch();
  console.log('Telegram bot polling started.');

  const stop = (signal) => {
    bot.stop(signal);
  };
  process.once('SIGINT', () => stop('SIGINT'));
  process.once('SIGTERM', () => stop('SIGTERM'));

  return bot;
}

function locationKeyboard() {
  return Markup.keyboard([
    [Markup.button.locationRequest('Share Location')],
  ]).resize();
}
