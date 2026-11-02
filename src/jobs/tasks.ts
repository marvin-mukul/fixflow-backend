import { requestService } from "../services/request.service.js";
import { registerTask } from "./scheduler.js";

registerTask("approval-reminders", () =>
  requestService.sendApprovalReminders(),
);
import { quoteService } from "../services/quote.service.js";
registerTask("quote-deadlines", () => quoteService.expireDue());
import { jobService } from "../services/job.service.js";
registerTask("auto-confirm", () => jobService.autoConfirmDue());
