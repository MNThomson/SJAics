import { parse } from "node-html-parser";
import ical, { ICalCalendar } from "ical-generator";
import { DateTime, Settings } from "luxon"
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

async function getCalNodeIds(yearMonth: String): Promise<number[]> {
    let resp = await fetch(`${ENV.URL}/calendar/${yearMonth}`);
    const root = parse(await resp.text());

    const nodeIds: number[] = [];
    const calEntries = root.querySelectorAll(
        "div.monthview > div.contents > #node-title > a",
    );
    for (const e of calEntries) {
        // Skip non-duties
        if (!e.parentNode.parentNode.parentNode.innerHTML.includes("Duty"))
            continue;

        const nodeId = +e.getAttribute("href")!.replace("/node/", "");
        // const eventName = decodeURI(e.innerText);
        nodeIds.push(nodeId);
    }

    return nodeIds;
}

type Shift = {
    start_time: DateTime<Valid>;
    end_time: DateTime<Valid>;
};

type NodeDetails = {
    id: number;
    title: string;
    meet_time: DateTime<Valid>;
    shifts: Shift[];
};

async function getNodeDetails(nodeId: number): Promise<NodeDetails> {
    let resp = await fetch(`${ENV.URL}/node/${nodeId}`, {
        headers: { cookie: ENV.COOKIE, contact: ENV.REPO_URL },
    });
    const root = parse(await resp.text());

    const dutyName = root.querySelector("#content-header > h1")?.text!;

    const shifts: Shift[] = root
        .querySelectorAll("table > caption > a > .date-display-single")
        .map((shiftel) => {
            const shift = shiftel.text.trim();
            const [, dateStr, startTimeStr, startTimeMeridiem, endTimeStr, endTimeMeridiem] = shift.match(
                /\w+, (\w+ \d+, \d+) - (\d+:\d+)(\w{2}) - (\d+:\d+)(\w{2})/,
            )!;
            return {
                start_time: DateTime.fromFormat(`${dateStr}, ${startTimeStr} ${startTimeMeridiem.toUpperCase()}`, "DDD, t") as DateTime<Valid>,
                end_time: DateTime.fromFormat(`${dateStr}, ${endTimeStr} ${endTimeMeridiem.toUpperCase()}`, "DDD, t") as DateTime<Valid>,
            };
        });

    const [, meet_time_hours, meet_time_meridiem] = root
        .querySelector(".views-field-field-mtg-time-value > span")
        ?.text!.match(/(\d+:\d+)(\w{2})/)!;
    let meet_time = DateTime.fromFormat(`${shifts[0].start_time.toFormat("DD")}, ${meet_time_hours} ${meet_time_meridiem.toUpperCase()}`, "ff") as DateTime<Valid>

    return {
        id: nodeId,
        title: dutyName,
        meet_time: meet_time,
        shifts: shifts,
    };
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
        switch (new URL(request.url).pathname) {
            case `/${env.APIKEY}/duties.ics`:
                let ics = await env.R2.get('duties.ics');
                return new Response(await ics?.text(), { headers: { "content-type": "text/calendar; charset=utf-8" } });
            default:
                return new Response("", { status: 401 })
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

        let events = (
            await Promise.all(
                nodeIds.map(async (nodeId) => {
                    try {
                        return await getNodeDetails(nodeId);
                    } catch (error) {
                        console.error(error);
                        return Promise.resolve(null);
                    }
                }),
            )
        ).filter((e): e is NodeDetails => e !== null);
        console.log(events);

        let c = createIcs(events);
        console.log(c.toString());
        await env.R2.put('duties.ics', c.toString())
    },
};
