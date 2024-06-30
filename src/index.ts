import { parse } from "node-html-parser";
import ical, { ICalCalendar } from "ical-generator";

import { NodeDetails, getDuties, getDutyDetails } from "./sjaparser";

export interface Env {
    R2: R2Bucket;

    COOKIE: string;
    URL: string;
    APIKEY: string;
    REPO_URL: string;
}

let ENV: Env;

async function getCalNodeIds(yearMonth: String): Promise<number[]> {
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
            calendar.createEvent({
                summary: event.title, // TODO: Add num signed up users to end
                start: event.meet_time,
                end: event.shifts[event.shifts.length - 1].end_time,
                url: `${ENV.URL}/node/${event.id}`,
                // TODO: add description (shifts, signed up users), location
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

        let nodeIds = await getCalNodeIds("");

        let nextMonth = new Date();
        nextMonth.setMonth(nextMonth.getMonth() + 1);
        nodeIds.push(...(await getCalNodeIds(nextMonth.toISOString().slice(0, 7))));

        /*
            let thirdMonth = new Date()
            thirdMonth.setMonth(thirdMonth.getMonth() + 2)
            nodeIds.push(...(await getCalNodeIds(thirdMonth.toISOString().slice(0, 7))))
        */

        let events: NodeDetails[] = [];
        for (const nodeId of nodeIds) {
            try {
                events.push(await getNodeDetails(nodeId));
            } catch (error) {
                console.error(`Could not get node details for ${nodeId}\n${error.stack}`);
            }
        }

        console.log(events);

        let c = createIcs(events);
        console.log(c.toString());
        await env.R2.put('duties.ics', c.toString())
    },
};
