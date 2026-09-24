import java.io.File
import org.apache.tools.ant.taskdefs.condition.Os
import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.logging.LogLevel
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.TaskAction

open class BuildTask : DefaultTask() {
    @Input
    var rootDirRel: String? = null
    @Input
    var target: String? = null
    @Input
    var release: Boolean? = null

    @TaskAction
    fun assemble() {
        val candidates = if (Os.isFamily(Os.FAMILY_WINDOWS)) {
            listOf("bun", "bun.exe", "bun.cmd", "bun.bat", "npm.cmd", "npm.exe", "npm")
        } else {
            listOf("bun", "npm")
        }
        var lastException: Exception? = null
        for (executable in candidates) {
            try {
                runTauriCli(executable)
                return
            } catch (error: Exception) {
                lastException = error
            }
        }
        throw lastException ?: GradleException("No supported JavaScript package runner found")
    }

    fun runTauriCli(executable: String) {
        val rootDirRel = rootDirRel ?: throw GradleException("rootDirRel cannot be null")
        val target = target ?: throw GradleException("target cannot be null")
        val release = release ?: throw GradleException("release cannot be null")
        val args = if (executable.startsWith("npm")) {
            listOf("exec", "--", "tauri", "android", "android-studio-script")
        } else {
            listOf("tauri", "android", "android-studio-script")
        };

        project.exec {
            workingDir(File(project.projectDir, rootDirRel))
            executable(executable)
            args(args)
            if (project.logger.isEnabled(LogLevel.DEBUG)) {
                args("-vv")
            } else if (project.logger.isEnabled(LogLevel.INFO)) {
                args("-v")
            }
            if (release) {
                args("--release")
            }
            args(listOf("--target", target))
        }.assertNormalExitValue()
    }
}