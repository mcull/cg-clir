import { Resend } from "resend";

// Email sending is optional — if RESEND_API_KEY isn't set, calls
// no-op and log a warning. Lets local dev (and first-deploy windows
// before the domain is verified in Resend) succeed without breaking
// the user-facing form.
const apiKey = process.env.RESEND_API_KEY;
const client = apiKey ? new Resend(apiKey) : null;

const FROM = process.env.EMAIL_FROM || "archive@creativegrowthart.com";
const NOTIFY_TO =
  process.env.MAILING_LIST_NOTIFY_TO || "quinn@creativegrowth.org";

export async function sendMailingListNotification(args: {
  name: string;
  email: string;
}) {
  if (!client) {
    console.warn(
      "[email] RESEND_API_KEY missing — skipping mailing-list notification",
      args,
    );
    return { skipped: true as const };
  }

  const { error } = await client.emails.send({
    from: FROM,
    to: NOTIFY_TO,
    subject: `New mailing list signup: ${args.name}`,
    text: [
      "A visitor signed up for the mailing list on the digital archive.",
      "",
      `Name:  ${args.name}`,
      `Email: ${args.email}`,
      "",
      "Add them to the primary CG mailing list when you have a moment.",
    ].join("\n"),
  });

  if (error) {
    throw new Error(`Resend error: ${error.message}`);
  }
  return { skipped: false as const };
}
