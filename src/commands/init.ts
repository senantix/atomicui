import { existsSync, promises as fs } from "fs";
import path, { resolve } from "path";
import prompts from "prompts";
import ora from "ora";
import { execa } from "execa";
import { Command } from "commander";

import { handleError } from "@/utils/handle-error";
import { logger } from "@/utils/logger";
import {
  getPackageManager,
  checkPackageExists,
} from "@/utils/get-package-info";
import { resolveConfigPaths, Config } from "@/utils/get-config";

import { getThemes, getInitData } from "@/utils/api";

export const init = new Command()
  .name("init")
  .description("initialize your project and install dependencies")
  .option(
    "-c, --cwd <cwd>",
    "the working directory. defaults to the current directory.",
    process.cwd()
  )
  .action(async (options) => {
    const cwd = path.resolve(options.cwd);
    try {
      logger.info("Initializing Atomic UI");
      const cwd = path.resolve(options.cwd);

      // Ensure target directory exists.
      if (!existsSync(cwd)) {
        logger.error(`The path ${cwd} does not exist. Please try again.`);
        process.exit(1);
      }

      const spinner = ora(`Validating project...`).start();
      // check for package.json
      if (!existsSync(path.resolve(cwd, "package.json"))) {
        spinner.fail();
        logger.error(
          `No package.json found in ${cwd}. Please run "npm init" first.`
        );
        process.exit(1);
      }

      // check if either next or react exists
      if (
        !checkPackageExists("react", cwd) &&
        !checkPackageExists("next", cwd)
      ) {
        spinner.fail();
        logger.error(
          `Missing required dependencies. Please install React or Next first.`
        );
        process.exit(1);
      }

      spinner.succeed();

      const projectConfig = await promptForProjectDetails(cwd);
      logger.info("Project configuration saved to getatomic.components.json");

      await runInit(cwd, projectConfig);
    } catch (error) {
      handleError(error);
      // delete atomic.components.json if it exists
      const configPath = path.resolve(cwd, "getatomic.components.json");
      if (existsSync(configPath)) {
        await fs.unlink(configPath);
      }
    }
  });

async function promptForProjectDetails(cwd: string) {
  const themes = await getThemes();

  const options = await prompts(
    [
      {
        type: "select",
        name: "theme",
        message: `Which theme would you like to use?`,
        choices: themes.map((theme) => ({
          title: theme.name,
          value: theme.id,
        })),
      },
      {
        type: "text",
        name: "globalCSS",
        message: `Where is your global CSS file?`,
        initial: "app/globals.css",
      },
      {
        type: "text",
        name: "components",
        message: `Configure the import alias for the atomic components.`,
        initial: "@/components/getatomic",
      },
    ],
    {
      onCancel: () => {
        throw new Error("Terminated Atomic UI setup.");
      },
    }
  );

  const atomicComponentsConfig = {
    theme: {
      name: options.theme,
      css: options.globalCSS,
    },
    alias: {
      components: options.components,
    },
  };

  const resolvedConfig = await resolveConfigPaths(
    cwd,
    atomicComponentsConfig as Config
  );

  if (
    resolvedConfig.resolvedPaths.components === "" ||
    resolvedConfig.resolvedPaths.css === ""
  ) {
    throw new Error(
      `Failed to resolve components alias, please enter a valid alias.`
    );
  }

  const { proceed } = await prompts({
    type: "confirm",
    name: "proceed",
    message: `Write configuration to "getatomic.components.json". Proceed?`,
    initial: true,
  });

  if (!proceed) {
    process.exit(0);
  }

  const spinner = ora(`Writing getatomic.components.json...`).start();
  const targetPath = path.resolve(cwd, "getatomic.components.json");
  await fs.writeFile(
    targetPath,
    JSON.stringify(atomicComponentsConfig, null, 2),
    "utf8"
  );
  spinner.succeed();

  return resolvedConfig;
}

export async function runInit(cwd: string, config: Config) {
  const spinner = ora(`Initializing project...`).start();

  if (!existsSync(config.resolvedPaths.components)) {
    await fs.mkdir(config.resolvedPaths.components, { recursive: true });
  }

  const initData = await getInitData({
    theme: config.theme.name,
  });

  // Write global CSS file. Create path if it doesn't exist.
  if (!existsSync(config.resolvedPaths.css)) {
    await fs.mkdir(path.dirname(config.resolvedPaths.css), { recursive: true });
  }
  await fs.writeFile(config.resolvedPaths.css, initData.css, "utf8");

  spinner.succeed();

  if (initData.dependencies.length === 0) {
    logger.info("No dependencies to install.");
  } else {
    const dependenciesSpinner = ora("").start();
    logger.info("Installing dependencies...");

    const packageManager = await getPackageManager(cwd);
    await execa(
      packageManager,
      [packageManager === "npm" ? "install" : "add", ...initData.dependencies],
      {
        cwd,
        stdio: "inherit",
      }
    );

    dependenciesSpinner.succeed();
  }
}
