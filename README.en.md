# Matthew Planner

[中文](README.md) | English

Use **ChatGPT Work conversations to enter your plans**, then view daily todos, appointments, and completed work in a Windows desktop app.

Just say: “I have an interview tomorrow at 10 a.m. Add an hour of project presentation prep for today.”
The interview appears in tomorrow's calendar, and the preparation appears in today's todo list.
Todos have a planned date and an optional estimated duration, so you do not have to choose a start time or task order.

![Matthew Planner daily planning view](docs/images/planner.png)

## Features

- **Daily todos**: Add tasks, change their dates, and check them off. Completed items keep their normal text and move to the bottom of the list.
- **Today's and tomorrow's appointments**: Today's appointments show prominent start times. Tomorrow's interviews and calls appear in the same side column to help you prepare ahead.
- **Weekly calendar**: The overview shows fixed appointments only, with an expandable weekly time grid.
- **Daily Notes**: Record progress and ideas in a text area that grows with your content.
- **Other todos**: Earlier unfinished tasks and tasks without a date stay together in the lower-right panel.
- **Completed work history**: Completed tasks become editable local time blocks, making it easy to review what you did during the day. These records are never uploaded to iCloud.
- **Undo**: Clear instructions apply directly with undo available. Discussion and ambiguous requests leave the plan unchanged.
- **Optional connections**: Read appointments from iCloud Calendar. With read-only Gmail authorization, select messages to extract related tasks and interviews. Writing an appointment to iCloud requires an explicit publishing action.

The interface uses warm white surfaces, dark gray text, and a few olive green accents.
Plans are stored locally, with no hosted backend.

## Download and install

Download the **Windows x64 Setup installer** from [GitHub Releases](https://github.com/mren2222/MatthewPlanner/releases/latest).
After installation, launch the app from the desktop or Start menu, or pin it to the taskbar.
Run a newer installer to update the same installation while keeping your existing plans and settings.
See [installation and updates](docs/INSTALL.md) for details (in Chinese).

## Enter plans through ChatGPT

Describe your plans in a **ChatGPT Work** conversation with access to your connected Windows computer.
The assistant reads the current plan, updates the app through its local input interface, and checks the result.
Codex can use the same interface. Connected Work input does not require an OpenAI API key in the app.

**Your computer must be online and Matthew Planner must be open when changes are applied.**
You can continue the conversation on your phone. If the computer is offline, keep your notes in the conversation and ask the assistant to sync them after reconnecting.
An ordinary ChatGPT conversation without computer access cannot modify this local app, and the app does not automatically retrieve chat history.
See [ChatGPT Work input setup](docs/WORK_INPUT.md) for connection requirements and assistant instructions.

## Optional setup and development

- [iCloud Calendar](docs/ICLOUD.md)
- [Read-only Gmail authorization](docs/GMAIL_SETUP.md)
- [In-app AI chat](docs/AI.md)
- [Development and verification](docs/DEVELOPMENT.md)

Data is stored under `%APPDATA%\Matthew Planner`. Close the app before backing up that directory.
Account credentials use Windows encrypted storage; reconnect your accounts when moving to another computer.
