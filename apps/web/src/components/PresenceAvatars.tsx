"use client";

export interface AwarenessUser {
  name: string;
  color: string;
}

const MAX_VISIBLE = 5;

export function PresenceAvatars({ users }: { users: AwarenessUser[] }) {
  const visible = users.slice(0, MAX_VISIBLE);
  const overflow = users.length - visible.length;

  return (
    <div
      className="presence"
      title={`${users.length} person(s) in this document: ${users
        .map((u) => u.name)
        .join(", ")}`}
    >
      {visible.map((user, index) => (
        <span
          key={`${user.name}-${index}`}
          className="presence-avatar"
          // Identity color exposed as a CSS variable: the liquid glass
          // look (translucent tint + blur) is built in the stylesheet
          style={{ "--user-color": user.color } as React.CSSProperties}
        >
          {user.name.trim().charAt(0).toUpperCase() || "?"}
        </span>
      ))}
      {overflow > 0 && <span className="presence-overflow">+{overflow}</span>}
      <span className="presence-count">
        {users.length} online
      </span>
    </div>
  );
}
