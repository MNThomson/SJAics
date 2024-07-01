import { parse } from "node-html-parser";
import ical, { ICalCalendar } from "ical-generator";

import { BasicNode, NodeDetails, getDuties, getDutyDetails } from "./sjaparser";
import { DateTime, Settings } from "luxon";
import { Valid } from "luxon/src/_util";

Settings.throwOnInvalid = true;
Settings.defaultZone = "America/Vancouver";

export interface Env {
    R2: R2Bucket;

    COOKIE: string;
    URL: string;
    APIKEY: string;
    REPO_URL: string;
}

let ENV: Env;

async function getCalNodeIds(yearMonth: String): Promise<BasicNode[]> {
    let resp = await fetch(`${ENV.URL}/calendar/${yearMonth}`);
    const root = parse(await resp.text());

    return getDuties(root);
}

async function getNodeDetails(nodeId: number): Promise<NodeDetails> {
    let resp = await fetch(`${ENV.URL}/node/${nodeId}`, {
        headers: { cookie: ENV.COOKIE, contact: ENV.REPO_URL },
    });
    const root = parse(await resp.text());

    return getDutyDetails(root, nodeId);
}

function createIcs(nodes: NodeDetails[]): ICalCalendar {
    const calendar = ical({ name: "SJA Duties", ttl: 3600 });
    nodes.map((event) => {
        try {
            const shiftDetails = "= Shifts\n" + event.shifts.map(e => `
== ${e.start_time.toFormat("T")} - ${e.end_time.toFormat("T")}
${e.users.map(u => `${u.name} - ${u.rank ? u.rank : u.qualification}`).join("\n")}
            `.trim()).join("\n\n");
            const description = `
${shiftDetails}
            `.trim()
            calendar.createEvent({
                summary: event.title, // TODO: Add num signed up users to end
                start: event.meet_time,
                end: event.shifts[event.shifts.length - 1].end_time,
                url: `${ENV.URL}/node/${event.id}`,
                // TODO: add description (shifts, signed up users), location
                description,
            });
        } catch (error) {
            console.error(error);
        }
    });

    return calendar;
}

export default {
    async fetch(
        request: Request,
        env: Env,
        ctx: ExecutionContext
    ) {
        let path = new URL(request.url).pathname
        if (!path.startsWith(`/${env.APIKEY}/`))
            return new Response("", { status: 401 });
        path = path.slice(env.APIKEY.length + 1);

        switch (path) {
            case "/duties.ics":
                let ics = await env.R2.get('duties.ics');
                return new Response(await ics?.text(), { headers: { "content-type": "text/calendar; charset=utf-8" } });
            case "/dev.ics":
                let dics = await env.R2.get('dev.ics');
                return new Response(await dics?.text(), { headers: { "content-type": "text/calendar; charset=utf-8" } });
            case "/reindex":
                await this.scheduled(null, env, null);
                return new Response("Reindex succesful");
            default:
                return new Response("", { status: 404 })
        }
    },

    async scheduled(
        event: ScheduledEvent,
        env: Env,
        ctx: ExecutionContext,
    ): Promise<void> {
        console.log("***************************************************");
        ENV = env;

        const today = DateTime.now().startOf('day');

        let nodes: BasicNode[] = [];
        for (const d of [today, today.plus({ months: 1 }), today.plus({ months: 2 })]) {
            nodes.push(...(await getCalNodeIds(d.toFormat("yyyy-MM"))));
        }

        let events: NodeDetails[] = [];
        for (const node of nodes) {
            // Skip all events that happened in the past, wastes less subrequests
            if (node.date <= DateTime.now().startOf('day').minus({ days: 8 })) continue;

            try {
                events.push(await getNodeDetails(node.id));
            } catch (error) {
                console.error(`Could not get node details for ${node}\n${error.stack}`);
                if (error.message.includes("Too many subrequests")) {
                    console.error("Stopping to get duties due to subrequest limit")
                    break
                }
            }
        }

        console.log(events);

        let c = createIcs(events);
        console.log(c.toString());
        await env.R2.put('duties.ics', c.toString())
    },
};
