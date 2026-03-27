import { baseLayout } from "./base";

interface TaskAssignedVars {
  assignerName: string;
  taskTitle: string;
  priority: string;
  deadline?: string;
  taskLink: string;
}

export function taskAssignedTemplate(vars: TaskAssignedVars): { subject: string; html: string } {
  const priorityColors: Record<string, string> = {
    P0: "#EF4444", P1: "#F97316", P2: "#A78BFA", P3: "#94A3B8",
  };
  const color = priorityColors[vars.priority] || "#A78BFA";

  const html = baseLayout(`
    <h1>New task assigned to you</h1>
    <p><span class="highlight">${vars.assignerName}</span> assigned you a task:</p>
    <div style="background: #1A1A26; border-radius: 8px; padding: 16px; margin: 16px 0;">
      <p style="margin: 0 0 8px; color: #E8E8F0; font-weight: 600;">${vars.taskTitle}</p>
      <span class="badge" style="background: ${color}20; color: ${color}; border: 1px solid ${color}40;">${vars.priority}</span>
      ${vars.deadline ? `<span style="margin-left: 12px; font-size: 12px; color: #8888A0;">Due: ${vars.deadline}</span>` : ""}
    </div>
    <p style="text-align: center;">
      <a href="${vars.taskLink}" class="btn">View Task</a>
    </p>
  `);

  return {
    subject: `${vars.assignerName} assigned you a task: ${vars.taskTitle}`,
    html,
  };
}
