import { DateTime, Settings } from "luxon";
import { Valid } from "luxon/src/_util";
import { HTMLElement } from "node-html-parser";

Settings.throwOnInvalid = true;
Settings.defaultZone = "America/Vancouver";

export enum Rank {
    None = "",
    Corporal = "Corporal",
    Sergeant = "Sergeant",
    StaffSergeant = "Staff Sergeant",
    DivisionalOfficer = "Divisional Officer",
    AreaOfficer = "Area Officer",
    ProvincialOfficer = "Provincial Officer",
    ProvincialCommissioner = "Provincial Commissioner",
}

export enum Qualification {
    MA = "MA",
    MFR = "MFR",
}

export type User = {
    name: string;
    rank: Rank;
    qualification: Qualification;
}

export type Shift = {
    start_time: DateTime<Valid>;
    end_time: DateTime<Valid>;
    users: User[];
};

export type NodeDetails = {
    id: number;
    title: string;
    meet_time: DateTime<Valid>;
    shifts: Shift[];
};

export type BasicNode = {
    id: number;
    title: string;
    date: DateTime<Valid>;
}

export async function getDuties(root: HTMLElement): Promise<BasicNode[]> {
    const basicNodes: BasicNode[] = [];
    const calEntries = root.querySelectorAll(
        "div.monthview > div.contents > #node-title > a",
    );
    for (const e of calEntries) {
        // Skip non-duties
        if (!e.parentNode.parentNode.parentNode.innerHTML.includes("Duty"))
            continue;

        const dayid = e.parentNode.parentNode.parentNode.parentNode.parentNode.parentNode.id;
        let eventDate = DateTime.fromFormat(dayid.slice(9), "yyyy-MM-dd-0") as DateTime<Valid>;

        const nodeId = +e.getAttribute("href")!.replace("/node/", "");
        const eventName = decodeURI(e.innerText);
        const node: BasicNode = {
            id: nodeId,
            title: eventName,
            date: eventDate
        }
        basicNodes.push(node);
    }

    return basicNodes;
}

export async function getDutyDetails(root: HTMLElement, nodeId: number): Promise<NodeDetails> {
    const dutyName = root.querySelector("#content-header > h1")?.text!;

    const shifts: Shift[] = root
        .querySelectorAll(".view-shiftlist > .view-content > table")
        .map((shiftel) => {
            const shift = shiftel.querySelector("caption > a > .date-display-single")!.text.trim();
            const [, dateStr, startTimeStr, startTimeMeridiem, endTimeStr, endTimeMeridiem] = shift.match(
                /\w+, (\w+ \d+, \d+) - (\d+:\d+)(\w{2}) - (\d+:\d+)(\w{2})/,
            )!;

            const users: User[] = shiftel.querySelectorAll("tbody > tr").flatMap(uel => {
                const udata = uel.querySelectorAll("td");
                const name = udata[0].text.trim()
                if (name)
                    return [{
                        name,
                        rank: udata[1].text.trim() as Rank,
                        qualification: udata[2].text.trim() as Qualification,
                    }];
                else return []
            });
            return {
                start_time: DateTime.fromFormat(`${dateStr}, ${startTimeStr} ${startTimeMeridiem.toUpperCase()}`, "DDD, t") as DateTime<Valid>,
                end_time: DateTime.fromFormat(`${dateStr}, ${endTimeStr} ${endTimeMeridiem.toUpperCase()}`, "DDD, t") as DateTime<Valid>,
                users,
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
