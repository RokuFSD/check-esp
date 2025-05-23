import {
  DOMParser,
  Element,
  HTMLDocument,
  Node,
  NodeList,
} from "jsr:@b-fuze/deno-dom";

// @ts-types="npm:@types/node-telegram-bot-api"
import TelegramBot from "node-telegram-bot-api";

const LINK = "https://www.cgeonline.com.ar/informacion/apertura-de-citas.html";
const TELEGRAM_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
const WEBHOOK_SECRET_TOKEN = Deno.env.get("WEBHOOK_SECRET_TOKEN");
const IN_DEV = Deno.env.get("DENO_ENV") === "development";
const WEBHOOK_URL = "emilianorui-check-esp-2.deno.dev";

const cachedChats: { [chatId: string]: boolean } = {};

if (!TELEGRAM_TOKEN) {
  throw new Error("TELEGRAM_BOT_TOKEN is not set");
}

if (!WEBHOOK_SECRET_TOKEN) {
  throw new Error("WEBHOOK_SECRET_TOKEN is not set");
}

const bot = new TelegramBot(TELEGRAM_TOKEN);

if (IN_DEV) {
  await bot.deleteWebHook();
} else {
  await bot.setWebHook(`${WEBHOOK_URL}/webhook`, {
    secret_token: WEBHOOK_SECRET_TOKEN,
  });
}

async function getHtml(link: string) {
  const response = await fetch(link);
  const html = await response.text();
  return html;
}

function parseHtml(parser: DOMParser, html: string): HTMLDocument {
  return parser.parseFromString(html, "text/html");
}

function getParentElement(elements: NodeList, keyword: string): Node | null {
  let parentElement: Node | null = null;
  elements.forEach((element) => {
    const childNodes = element.childNodes;
    childNodes.forEach((td) => {
      const textContent = td.textContent || "";
      if (!textContent || !textContent.includes(keyword)) return;
      parentElement = td.parentNode;
    });
  });
  return parentElement;
}

function getEachChildElementText(element: Node | null) {
  if (!element) return null;
  const childNodes = element.childNodes;
  const textArray: string[] = [];
  childNodes.forEach((child) => {
    if (child.nodeType === Node.ELEMENT_NODE) {
      const childElement = child as Element;
      const childText = childElement.textContent || "";
      if (childText) {
        textArray.push(childText.trim());
      }
    }
  });
  return textArray;
}

async function handleUpdate(update: TelegramBot.Update) {
  if (update.message) {
    const msg = update.message;
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const messageText = msg.text;

    if (!userId) {
      return;
    }

    if (messageText === "/start") {
      bot.sendMessage(chatId, "Tap en Iniciar.", {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "Iniciar",
                callback_data: "main",
              },
            ],
          ],
        },
      });
    }
  } else if (update.callback_query) {
    const callbackQuery = update.callback_query;
    const chatId = callbackQuery.message?.chat.id;
    if (chatId && callbackQuery.data === "main") {
      if (chatId in cachedChats) {
        bot.sendMessage(chatId, `Devolviendo, ya esta registrado`);
      } else {
        cachedChats[chatId] = true;
        bot.sendMessage(
          chatId,
          `Se notificará cuando haya un nuevo turno. ${chatId}`,
        );
        // Using Deno.cron send a message each 30 minutes
        Deno.cron("Send status", "*/10 * * * *", async () => {
          bot.sendMessage(chatId, "Bot corriendo sin problemas");
          const { lastDate, newDate } = await getStatus();
          if (newDate.includes("confirmar")) return;
          bot.sendMessage(
            chatId,
            `SE PUEDE SACAR TURNO\nLast Date: ${lastDate}\nNew Date: ${newDate}`,
          );
        });
      }
    }
    bot.answerCallbackQuery(callbackQuery.id);
  }
}

async function getStatus() {
  const html = await getHtml(LINK);
  const parser = new DOMParser();
  const dom = parseHtml(parser, html);
  const allTr = dom.querySelectorAll("tr");
  const keywordOnly = getParentElement(allTr, "Pasaportesrenova");
  const texts = getEachChildElementText(keywordOnly);
  const [title, lastDate, newDate] = texts || [];
  console.log(title, lastDate, newDate);
  return {
    title,
    lastDate,
    newDate,
  };
}

async function main() {
  if (IN_DEV) {
    let offset = 0;
    console.debug("Bot", "Starting bot in development mode using getUpdates");

    while (true) {
      try {
        const updates = await bot.getUpdates({
          offset,
          timeout: 30,
        });

        for (const update of updates) {
          // Process update
          try {
            await handleUpdate(update);
          } catch (error) {
            console.error("Update Handler", "Failed to process update", error);
          }
          // Update offset to acknowledge update
          offset = update.update_id + 1;
        }
      } catch (error) {
        console.error("GetUpdates", "Failed to get updates", error);
        // Wait a bit before retrying to avoid flooding in case of persistent errors
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  } else {
    // Start webhook server
    Deno.serve(async (req: Request) => {
      if (
        req.method === "POST" &&
        req.url.includes("/webhook") &&
        req.headers.get("X-Telegram-Bot-Api-Secret-Token") ===
          WEBHOOK_SECRET_TOKEN
      ) {
        try {
          const update = (await req.json()) as TelegramBot.Update;
          await handleUpdate(update);
          return new Response("OK", { status: 200 });
        } catch (error) {
          console.error("Webhook", "Failed to process update", error);
          return new Response("Error processing update", { status: 500 });
        }
      }
      return new Response("Not found", { status: 404 });
    });
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error);
  }
}
