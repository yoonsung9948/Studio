import { FileText, ImageIcon, Video } from "lucide-react";
import { Link } from "react-router-dom";
import { type ProductionEvent, relativeEventTime } from "./production-data";
export function ProductionActivity({ events }: { events: ProductionEvent[] }) {
  return events.length ? (
    <ol className="production-activity-list">
      {events.map((event) => {
        const Icon =
          event.kind === "script"
            ? FileText
            : event.kind === "video"
              ? Video
              : ImageIcon;
        return (
          <li key={event.id}>
            <Link to={event.href}>
              <Icon size={21} strokeWidth={1.5} />
              {event.thumbnail && (
                <img src={event.thumbnail} alt="" loading="lazy" />
              )}
              <div className="production-event-copy">
                <div>
                  <b>{event.title}</b>
                  {event.occurredAt && (
                    <time
                      dateTime={new Date(event.occurredAt).toISOString()}
                      title={new Date(event.occurredAt).toLocaleString()}
                    >
                      {relativeEventTime(event.occurredAt)}
                    </time>
                  )}
                </div>
                <p>{event.detail}</p>
              </div>
            </Link>
          </li>
        );
      })}
    </ol>
  ) : (
    <div className="production-empty-activity">
      <FileText size={25} />
      <p>No activity yet.</p>
      <span>Script approvals and generated frames will appear here.</span>
    </div>
  );
}
